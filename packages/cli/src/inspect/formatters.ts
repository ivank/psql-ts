import { isNil, isUnique } from '@potygen/ast';
import { isTypeNullable, TypeConstant } from '@potygen/query';
import { LoadedDataTable, LoadedDataView, LoadedSource, LoadedDataEnum, LoadedDataComposite } from '../types';

const join = (separator: string, parts: (string | undefined)[]) => parts.filter(isNil).join(separator);

const wrap =
  (side: string) =>
  (text?: string): string | undefined =>
    text !== undefined ? side + text + side : undefined;

const code = wrap('`');
const bold = wrap('**');
const tableRow = wrap('|');
const formatSql = (text: string) => `\`\`\`sql\n${text}\n\`\`\``;

const markdownTable = (rows: string[][]): string => rows.map((row) => tableRow(row.join('|'))).join('\n');

const formatSourceName = (source: LoadedSource): string => {
  switch (source.type) {
    case 'Query':
    case 'Values':
      return `${source.name} ${code(source.type)}`;
    case 'Table':
    case 'View':
      const name = join('.', [source.schema === 'public' ? undefined : source.schema, source.table]);
      return `${join(' AS ', [name, source.table === source.name ? undefined : source.name])} ${source.type}`;
  }
};

const formatPostgresType = (type: string): string => {
  switch (type) {
    case 'time with time zone':
      return 'timetz';
    case 'time without time zone':
      return 'time';
    case 'timestamp without time zone':
      return 'timestamp';
    case 'timestamp with time zone':
      return 'timestamptz';
    default:
      return type;
  }
};

const formatSourceColumns = (source: LoadedSource): string =>
  markdownTable([
    ['Name', 'Type'],
    ['---', '---'],
    ...Object.entries(source.items).flatMap(([name, type]) => {
      const isNotNull = type && isTypeNullable(type) && !type.nullable;
      return [
        [name, join(' ', [bold(formatPostgresType(type.postgresType)), code(isNotNull ? 'NOT_NULL' : 'NULL')])],
        ...(type.comment
          ? type.comment
              .trim()
              .split('\n')
              .map((line) => ['', line])
          : []),
      ];
    }),
  ]);

const formatComposite = (source: LoadedDataComposite): string =>
  markdownTable([
    ['Name', 'Type'],
    ['---', '---'],
    ...source.data
      .filter(isUnique((item) => item.name))
      .map((item) => [
        item.name,
        join(' ', [bold(formatPostgresType(item.type)), code(item.isNullable ? 'NULL' : 'NOT_NULL')]),
      ]),
  ]);

const formatEnum = (dataEnum: LoadedDataEnum): string =>
  join('\n\n---\n\n', [
    dataEnum.comment,
    markdownTable([['Variants'], ['---'], ...dataEnum.data.filter(isUnique()).map((variant) => [variant])]),
  ]);

export const quickInfoColumn = (
  source: LoadedSource,
  name: string,
  type: TypeConstant,
  details?: LoadedDataEnum | LoadedDataComposite,
): { display: string; description: string } => {
  const isNotNull = type && isTypeNullable(type) && !type.nullable;
  return {
    display: join(' ', [name, formatPostgresType(type?.postgresType), isNotNull ? 'NOT NULL' : undefined]),
    description: join('\n\n---\n\n', [
      `From: ${formatSourceName(source)}`,
      type?.comment,
      details?.type === 'Enum'
        ? formatEnum(details)
        : details?.type === 'Composite'
        ? formatComposite(details)
        : undefined,
    ]),
  };
};

export const quickInfoEnum = (dataEnum: LoadedDataEnum): { display: string; description: string } => ({
  display: 'Enum',
  description: formatEnum(dataEnum),
});

export const quickInfoSource = (source: LoadedSource): { display: string; description: string } => ({
  display: formatSourceName(source),
  description: formatSourceColumns(source),
});

export const quickInfoTable = (
  source: LoadedSource,
  table: LoadedDataTable,
): { display: string; description: string } => ({
  display: formatSourceName(source),
  description: join('\n\n---\n\n', [table.comment, formatSourceColumns(source)]),
});

export const quickInfoView = (
  source: LoadedSource,
  view: LoadedDataView,
): { display: string; description: string } => ({
  display: formatSourceName(source),
  description: join('\n\n---\n\n', [view.comment, formatSourceColumns(source), formatSql(view.data)]),
});
