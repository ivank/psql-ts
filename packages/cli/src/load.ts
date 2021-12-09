import { isEqual, groupBy, isNil } from '@potygen/ast';
import {
  isTypeEqual,
  QueryInterface,
  Source,
  sql,
  toPgType,
  Type,
  TypeConstant,
  toContantBinaryOperatorVariant,
  isTypeNullable,
  isTypeArrayConstant,
  isTypeLoadStar,
  TypeUnionConstant,
  TypeLoadColumn,
  Param,
} from '@potygen/query';
import { ClientBase } from 'pg';
import {
  isDataTable,
  isDataFunction,
  isDataEnum,
  isLoadedDataTable,
  isLoadedDataEnum,
  isLoadedDataFunction,
} from './guards';
import { LoadError } from './errors';
import {
  LoadedDataEnum,
  LoadedDataFunction,
  Data,
  LoadedData,
  DataTable,
  LoadedQueryInterface,
  LoadedDataColumn,
  LoadedFunction,
  LoadedSource,
  LoadedContext,
  LoadedParam,
} from './types';
import { FunctionsSqlQuery, EnumsSqlQuery, TableEnumsSqlQuery, TablesSqlQuery } from './__generated__/load.queries';

const tablesSql = sql<TablesSqlQuery>`
  SELECT
    'Table' AS "type",
    json_build_object('schema', table_schema, 'name', table_name) AS "name",
    json_agg(
      json_build_object('name', column_name, 'isNullable', is_nullable, 'enum', udt_name, 'type', data_type)
      ORDER BY columns.ordinal_position ASC
    ) AS "columns"
  FROM information_schema.columns
  WHERE (table_schema, table_name) IN ($$tableNames(schema, name))
  GROUP BY columns.table_schema, columns.table_name`;

const tableEnumsSql = sql<TableEnumsSqlQuery>`
  SELECT
    'Enum' AS "type",
    pg_type.typname as "name",
    JSONB_AGG(pg_enum.enumlabel ORDER BY pg_enum.enumsortorder) as "enum"
  FROM pg_catalog.pg_type
  JOIN pg_catalog.pg_enum ON pg_enum.enumtypid = pg_type.oid
  LEFT JOIN information_schema.columns
    ON columns.data_type = 'USER-DEFINED'
    AND columns.udt_name = pg_catalog.pg_type.typname
  WHERE
    (table_schema, table_name) IN ($$tableNames(schema, name))
    AND pg_type.typcategory = 'E'
  GROUP BY pg_type.typname, pg_type.typcategory, pg_type.oid`;

const enumsSql = sql<EnumsSqlQuery>`
  SELECT
    'Enum' AS "type",
    pg_type.typname as "name",
    JSONB_AGG(pg_enum.enumlabel ORDER BY pg_enum.enumsortorder ASC) as "enum"
  FROM pg_catalog.pg_type
  JOIN pg_catalog.pg_enum ON pg_enum.enumtypid = pg_type.oid
  LEFT JOIN information_schema.columns
    ON columns.data_type = 'USER-DEFINED'
    AND columns.udt_name = pg_catalog.pg_type.typname
  WHERE
    pg_type.typname = ANY($enumNames)
    AND pg_type.typcategory = 'E'
  GROUP BY pg_type.typname, pg_type.typcategory, pg_type.oid`;

const functionsSql = sql<FunctionsSqlQuery>`
  SELECT
    'Function' AS "type",
    routines.routine_schema AS "schema",
    COALESCE(routines.routine_name, '_') AS "name",
    COALESCE(routines.data_type, 'any') AS "returnType",
    COALESCE(routines.routine_definition = 'aggregate_dummy', FALSE) AS "isAggregate",
    JSONB_AGG(parameters.data_type ORDER BY parameters.ordinal_position ASC) AS "argTypes"
  FROM information_schema.routines
  LEFT JOIN information_schema.parameters ON parameters.specific_name = routines.specific_name
  WHERE routine_name = ANY($functionNames)
  GROUP BY (
    routines.routine_schema,
    routines.routine_name,
    routines.data_type,
    routines.specific_name,
    routines.routine_definition
  )`;

const loadData = async (db: ClientBase, data: Data[]): Promise<LoadedData[]> => {
  const tableNames = data.filter(isDataTable).map(({ name }) => name);
  const functionNames = data.filter(isDataFunction).map(({ name }) => name);
  const enumNames = data.filter(isDataEnum).map(({ name }) => name);

  return (
    await Promise.all([
      tableNames.length ? tablesSql.run(db, { tableNames }) : [],
      tableNames.length ? tableEnumsSql.run(db, { tableNames }) : [],
      enumNames.length ? enumsSql.run(db, { enumNames }) : [],
      functionNames.length ? functionsSql.run(db, { functionNames }) : [],
    ])
  ).flat();
};

const toSourceTables = (source: Source): DataTable[] =>
  source.type === 'Table'
    ? [{ type: 'Table', name: toTableName(source.schema, source.table) }]
    : source.value.sources.flatMap(toSourceTables);

const extractDataFromType = (type: Type): Data[] => {
  switch (type.type) {
    case 'LoadRecord':
      return [{ type: 'Enum', name: type.name }];
    case 'LoadFunction':
    case 'LoadFunctionArgument':
      return [{ type: 'Function', name: type.name }, ...type.args.flatMap(extractDataFromType)];
    case 'Named':
      return extractDataFromType(type.value);
    case 'Array':
      return extractDataFromType(type.items);
    case 'Coalesce':
      return type.items.flatMap(extractDataFromType);
    case 'LoadFunction':
      return type.args.flatMap(extractDataFromType);
    case 'LoadOperator':
      return extractDataFromType(type.left).concat(extractDataFromType(type.right));
    default:
      return [];
  }
};

const extractDataFromQueryInterface = ({ sources, params, results }: QueryInterface): Data[] => [
  ...sources.flatMap(toSourceTables),
  ...params.flatMap(({ type, pick }) => [
    ...extractDataFromType(type),
    ...pick.flatMap(({ type }) => extractDataFromType(type)),
  ]),
  ...results.flatMap(({ type }) => extractDataFromType(type)),
];

const notLoaded =
  (data: LoadedData[]) =>
  ({ type, name }: Data) =>
    !data.some((item) => type === item.type && isEqual(name, item.name));

const toLoadedParam =
  (toType: (type: Type) => TypeConstant) =>
  ({ name, type, pick, spread, required }: Param): LoadedParam => {
    const paramType: TypeConstant =
      pick.length > 0
        ? {
            type: 'ObjectLiteralConstant',
            nullable: !required,
            items: pick.map((item) => ({ name: item.name, type: toType(item.type) })),
          }
        : toType(type);
    return { name, type: spread ? { type: 'ArrayConstant', items: paramType } : paramType };
  };

const groupLoadedParams = (params: LoadedParam[]): LoadedParam[] =>
  Object.entries(groupBy((param) => param.name, params)).map(([name, params]) =>
    params.length === 1
      ? params[0]
      : { name, type: { type: 'UnionConstant', items: params.map((param) => param.type) } },
  );

const loadTypeConstant = (type: string, nullable?: boolean): TypeConstant => {
  const sqlType = toPgType(type);
  if (!sqlType) {
    throw Error(`'${type}' was not part of the known postgres types or aliases`);
  }
  return nullable && isTypeNullable(sqlType) ? { ...sqlType, nullable } : sqlType;
};

const dataColumnToTypeConstant = (enums: Record<string, TypeUnionConstant>, column: LoadedDataColumn): TypeConstant =>
  column.type === 'USER-DEFINED'
    ? { ...enums[column.enum], nullable: column.isNullable === 'YES' }
    : loadTypeConstant(column.type, column.isNullable === 'YES');

const toLoadedFunction = ({ returnType, argTypes, isAggregate, ...rest }: LoadedDataFunction): LoadedFunction => ({
  ...rest,
  isAggregate: Boolean(isAggregate),
  returnType: loadTypeConstant(returnType),
  argTypes: argTypes.map((arg) => loadTypeConstant(arg)),
});

const toLoadedEnum = (enums: LoadedDataEnum[]): Record<string, TypeUnionConstant> =>
  enums.reduce<Record<string, TypeUnionConstant>>(
    (acc, { name, enum: items }) => ({
      ...acc,
      [name]: { type: 'UnionConstant', items: items.map((item) => ({ type: 'String', literal: item })) },
    }),
    {},
  );

const toTableName = (schema: string | undefined, name: string): { name: string; schema: string } => ({
  name: name.toLowerCase(),
  schema: schema?.toLowerCase() ?? 'public',
});

const toLoadedSource = (data: LoadedData[], enums: Record<string, TypeUnionConstant>) => {
  const tables = data.filter(isLoadedDataTable);
  const loadedQueryInterface = toLoadedQueryInterface(data);

  return (source: Source): LoadedSource => {
    switch (source.type) {
      case 'Table':
        const table = tables.find((table) => isEqual(table.name, toTableName(source.schema, source.table)));
        if (!table) {
          throw new LoadError(source.sourceTag, `Table ${formatTableName(source)} not found in the database`);
        }
        return {
          type: 'Table',
          name: source.name,
          table: table.name.name,
          schema: table.name.schema,
          isResult: source.isResult,
          items: table.columns.reduce<Record<string, TypeConstant>>(
            (acc, column) => ({ ...acc, [column.name]: dataColumnToTypeConstant(enums, column) }),
            {},
          ),
        };
      case 'Query':
        return {
          type: 'Query',
          name: source.name,
          items: loadedQueryInterface(source.value).results.reduce<Record<string, TypeConstant>>(
            (acc, result) => ({ ...acc, [result.name]: result.type }),
            {},
          ),
        };
    }
  };
};

const toLoadedContext = (data: LoadedData[], sources: Source[]): LoadedContext => {
  const enums = toLoadedEnum(data.filter(isLoadedDataEnum));
  const loadedSources = sources.map(toLoadedSource(data, enums));
  const funcs = data.filter(isLoadedDataFunction).map(toLoadedFunction);

  return { sources: loadedSources, funcs, enums };
};

const matchFuncVariant =
  (args: TypeConstant[]) =>
  (func: LoadedFunction): boolean =>
    func.argTypes.every((argType, index) => isTypeEqual(argType, args[index] ?? { type: 'Unknown' }));

const isResultSource = (isResult: boolean) => (source: LoadedSource) =>
  source.type === 'Table' ? (isResult ? source.isResult : true) : true;

const matchTypeSource = (type: TypeLoadColumn) => (source: LoadedSource) =>
  type.table
    ? source.type === 'Table' && type.schema
      ? source.schema === type.schema && source.name == type.table
      : source.name === type.table
    : true;

const formatLoadedSource = (source: LoadedSource): string =>
  source.type === 'Table' ? `[${source.name}: (${formatTableName(source)})]` : `[${source.name}: Subquery]`;
const formatTableName = ({ name, schema }: { name: string; schema?: string }): string =>
  schema && schema !== 'public' ? `${schema}.${name}` : name;
const formatArgumentType = ({ type }: Type): string => type;

const formatLoadColumn = ({ schema, table, column }: TypeLoadColumn): string =>
  [schema, table, column].filter(isNil).join('.');

const toTypeConstant = (context: LoadedContext, isResult: boolean) => {
  return (type: Type): TypeConstant => {
    const recur = toTypeConstant(context, isResult);
    switch (type.type) {
      case 'LoadColumn':
        const relevantSources = context.sources.filter(matchTypeSource(type)).filter(isResultSource(isResult));
        const columns = relevantSources.flatMap((source) => source.items[type.column.toLowerCase()] ?? []);

        if (relevantSources.length === 0) {
          throw new LoadError(
            type.sourceTag,
            `Column ${formatLoadColumn(type)} is not present in ${context.sources.map(formatLoadedSource).join(', ')}`,
          );
        } else if (columns.length > 1) {
          throw new LoadError(
            type.sourceTag,
            `Ambiguous column ${formatLoadColumn(type)}, appears in multiple tables: (${relevantSources
              .map(formatLoadedSource)
              .join(', ')}).`,
          );
        } else if (columns.length === 0) {
          throw new LoadError(
            type.sourceTag,
            `Column ${formatLoadColumn(type)} not found in ${relevantSources.map(formatLoadedSource).join(', ')}`,
          );
        } else {
          return columns[0];
        }
      case 'LoadRecord':
        return context.enums[type.name] ?? { type: 'Unknown' };
      case 'LoadFunction':
      case 'LoadFunctionArgument':
        const args = type.args.map(recur);
        const variants = context.funcs.filter((func) => func.name === type.name);
        const funcVariant = variants.find(matchFuncVariant(args));

        if (!funcVariant) {
          const formattedArgs = args.map(formatArgumentType).join(', ');
          const availableVariants = variants
            .map((variant) => `(${variant.argTypes.map(formatArgumentType).join(', ')})`)
            .join(', ');

          throw new LoadError(
            type.sourceTag,
            `No variant of ${type.name} with arguments: (${formattedArgs}). Available variants were: ${availableVariants}`,
          );
        } else {
          switch (type.type) {
            case 'LoadFunction':
              return funcVariant.isAggregate && isTypeArrayConstant(funcVariant.returnType)
                ? funcVariant.returnType.items
                : funcVariant.returnType;
            case 'LoadFunctionArgument':
              return funcVariant.argTypes[type.index];
          }
        }
      case 'LoadStar':
        throw new LoadError(type.sourceTag, 'Should never have load star here');
      case 'ToArray':
        const items = recur(type.items);
        return isTypeArrayConstant(items) ? items : { type: 'ArrayConstant', items };
      case 'Array':
        return { type: 'ArrayConstant', items: recur(type.items) };
      case 'Union':
        return { type: 'UnionConstant', items: type.items.map(recur) };
      case 'ArrayItem':
        return recur(type.value);
      case 'ObjectLiteral':
        return {
          type: 'ObjectLiteralConstant',
          items: type.items.map((item) => ({ ...item, type: recur(item.type) })),
        };
      case 'LoadOperator':
        const left = recur(type.left);
        const right = recur(type.right);
        const operatorResult = toContantBinaryOperatorVariant(type.available, left, right, type.index);
        return isTypeNullable(operatorResult) &&
          ((isTypeNullable(left) && left.nullable) || (isTypeNullable(right) && right.nullable))
          ? { ...operatorResult, nullable: true }
          : operatorResult;
      case 'Coalesce':
        const argTypes = type.items.map(recur);
        return {
          type: 'UnionConstant',
          items: argTypes,
          nullable: argTypes.reduce<boolean>(
            (isNullable, type) => isNullable && isTypeNullable(type) && Boolean(type.nullable),
            true,
          ),
        };
      case 'Named':
        return recur(type.value);
      default:
        return type;
    }
  };
};

export const loadQueryInterfacesData = async (
  db: ClientBase,
  queryInterfaces: QueryInterface[],
  data: LoadedData[],
): Promise<LoadedData[]> =>
  data.concat(await loadData(db, queryInterfaces.flatMap(extractDataFromQueryInterface).filter(notLoaded(data))));

export const toLoadedQueryInterface =
  (data: LoadedData[]) =>
  ({ sources, params, results }: QueryInterface): LoadedQueryInterface => {
    const context = toLoadedContext(data, sources);
    const toTypeParam = toTypeConstant(context, false);
    const toTypeResult = toTypeConstant(context, true);
    return {
      params: groupLoadedParams(params.map(toLoadedParam(toTypeParam))),
      results: results.flatMap(({ name, type }) =>
        isTypeLoadStar(type)
          ? context.sources
              .filter((source) => (type.table ? source.name === type.table : true))
              .flatMap((source) => Object.entries(source.items).map(([name, type]) => ({ name, type })))
          : { name, type: toTypeResult(type) },
      ),
    };
  };
