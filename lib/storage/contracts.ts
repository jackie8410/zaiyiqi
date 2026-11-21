// The application depends on these contracts, not on a hosting vendor's SDK.
export type Row = Record<string, any>;
export type SqlValue = string | number | null | ArrayBuffer;
export interface QueryResult<T = Row> { results: T[]; success: boolean; meta: {changes: number; [key: string]: unknown} }
export interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T = Row>(column?: string): Promise<T | null>;
  all<T = Row>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult>;
}
export interface Database {
  prepare(sql: string): Statement;
  // Must commit all statements together or roll all of them back.
  batch<T = Row>(statements: Statement[]): Promise<QueryResult<T>[]>;
}
export interface StoredFile {
  body: ReadableStream<Uint8Array> | Uint8Array;
  size: number;
  httpMetadata?: {contentType?: string};
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface FileStore {
  get(key: string): Promise<StoredFile | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream, options?: {
    httpMetadata?: {contentType?: string}; customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  delete(keys: string | string[]): Promise<unknown>;
  list(options: {prefix?: string; cursor?: string; limit?: number}): Promise<{
    objects: {key: string; size: number}[]; truncated: boolean; cursor?: string;
  }>;
}
export interface StorageAdapter {database: Database; files: FileStore; name: string}
