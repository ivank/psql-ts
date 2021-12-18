import { TableTag, Tag } from '@potygen/ast';

export interface TypeLoad {
  sourceTag: Tag;
}
export interface TypeString {
  type: 'String';
  literal?: string;
  nullable?: boolean;
}
export interface TypeBuffer {
  type: 'Buffer';
  nullable?: boolean;
}
export interface TypeNumber {
  type: 'Number';
  literal?: number;
  nullable?: boolean;
}
export interface TypeBoolean {
  type: 'Boolean';
  literal?: boolean;
  nullable?: boolean;
}
export interface TypeDate {
  type: 'Date';
  nullable?: boolean;
}
export interface TypeNull {
  type: 'Null';
}
export interface TypeJson {
  type: 'Json';
  nullable?: boolean;
}
export interface TypeUnknown {
  type: 'Unknown';
}
export interface TypeAny {
  type: 'Any';
}
export interface TypeCoalesce {
  type: 'Coalesce';
  items: Type[];
}
export interface TypeLoadRecord extends TypeLoad {
  type: 'LoadRecord';
  name: string;
  schema?: string;
}
export interface TypeLoadFunction extends TypeLoad {
  type: 'LoadFunction';
  name: string;
  schema?: string;
  args: Type[];
}
export interface TypeLoadColumn extends TypeLoad {
  type: 'LoadColumn';
  column: string;
  table?: string;
  schema?: string;
}
export interface TypeLoadStar extends TypeLoad {
  type: 'LoadStar';
  table?: string;
  schema?: string;
}
export interface TypeLoadFunctionArgument extends TypeLoad {
  type: 'LoadFunctionArgument';
  index: number;
  name: string;
  schema?: string;
  args: Type[];
}
export interface TypeLoadOperator extends TypeLoad {
  type: 'LoadOperator';
  index: 0 | 1 | 2;
  left: Type;
  right: Type;
  available: Array<[TypeConstant, TypeConstant, TypeConstant]>;
}
export interface TypeNamed {
  type: 'Named';
  name: string;
  value: Type;
}
export interface TypeArray {
  type: 'Array';
  items: Type;
}
export interface TypeToArray {
  type: 'ToArray';
  items: Type;
}
export interface TypeArrayItem {
  type: 'ArrayItem';
  value: Type;
}
export interface TypeCompositeAccess {
  type: 'CompositeAccess';
  value: Type;
  name: string;
  sourceTag: Tag;
}
export interface TypeCompositeConstant {
  type: 'CompositeConstant';
  name: string;
  schema?: string;
  attributes: Record<string, TypeConstant>;
}
export interface TypeUnion {
  type: 'Union';
  items: Type[];
}
export interface TypeArrayConstant {
  type: 'ArrayConstant';
  items: TypeConstant;
  nullable?: boolean;
}
export interface TypeUnionConstant {
  type: 'UnionConstant';
  items: TypeConstant[];
  nullable?: boolean;
}
export interface TypeObjectLiteral {
  type: 'ObjectLiteral';
  items: Array<{ name: string; type: Type }>;
  nullable?: boolean;
}
export interface TypeObjectLiteralConstant {
  type: 'ObjectLiteralConstant';
  items: Array<{ name: string; type: TypeConstant }>;
  nullable?: boolean;
}

export type TypeLiteral = TypeString | TypeNumber | TypeBoolean;

export type TypeNullable =
  | TypeBuffer
  | TypeString
  | TypeNumber
  | TypeBoolean
  | TypeDate
  | TypeJson
  | TypeArrayConstant
  | TypeUnionConstant;

export type TypeConstant =
  | TypeBuffer
  | TypeAny
  | TypeString
  | TypeNumber
  | TypeBoolean
  | TypeDate
  | TypeNull
  | TypeJson
  | TypeUnknown
  | TypeCompositeConstant
  | TypeArrayConstant
  | TypeUnionConstant
  | TypeObjectLiteralConstant;

export type Type =
  | TypeConstant
  | TypeLoadColumn
  | TypeLoadFunction
  | TypeLoadFunctionArgument
  | TypeLoadRecord
  | TypeLoadStar
  | TypeLoadOperator
  | TypeNamed
  | TypeCoalesce
  | TypeArray
  | TypeToArray
  | TypeArrayItem
  | TypeCompositeAccess
  | TypeUnion
  | TypeObjectLiteral;

export interface Result {
  name: string;
  type: Type | TypeLoadStar;
}

export interface Param {
  name: string;
  type: Type;
  pos: number;
  nextPos: number;
  required: boolean;
  pick: Array<{ name: string; type: Type }>;
  spread: boolean;
}

export type Source = SourceTable | SourceQuery | SourceValues;

export interface SourceTable {
  type: 'Table';
  sourceTag: Tag;
  isResult?: boolean;
  schema?: string;
  table: string;
  name: string;
}

export interface SourceValues {
  type: 'Values';
  sourceTag: Tag;
  types?: TypeNamed[];
  name: string;
}

export interface SourceQuery {
  type: 'Query';
  sourceTag: Tag;
  name: string;
  value: QueryInterface;
}

export interface QueryInterface {
  params: Param[];
  results: Result[];
  sources: Source[];
}

export interface TypeContext {
  type: Type;
  columns: TypeLoadColumn[];
  from?: TableTag;
}
