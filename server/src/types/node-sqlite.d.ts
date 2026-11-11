/**
 * Type declarations for node:sqlite (Node.js 22.5+).
 * These supplement @types/node when the installed version
 * doesn't yet include sqlite types, or when types lag behind
 * the runtime (e.g. Node 25 with @types/node 22.x).
 *
 * The real module is a Node.js built-in — no npm package needed.
 */

declare module "node:sqlite" {
  /** Options for DatabaseSync constructor */
  export interface DatabaseSyncOptions {
    /** Open the database in read-only mode. Default: false */
    readOnly?: boolean;
    /** Allow the database to be opened even if it does not exist. Default: false */
    allowBareNamedParameters?: boolean;
    /** Enable or disable loading of extensions. Default: false */
    allowExtension?: boolean;
  }

  /** Options for StatementSync.run() / .get() / .all() */
  export type SupportedValueType = null | number | bigint | string | Uint8Array | ArrayBuffer;
  export type BindingDictionary = Record<string, SupportedValueType>;
  export type BindingArray = SupportedValueType[];

  /** Result of StatementSync.run() */
  export interface RunResult {
    /** Number of rows modified */
    changes: number;
    /** Row ID of the last inserted row */
    lastInsertRowid: number | bigint;
  }

  /** A prepared statement */
  export interface StatementSync {
    run(...params: BindingArray | [BindingDictionary]): RunResult;
    get(...params: BindingArray | [BindingDictionary]): Record<string, SupportedValueType> | undefined;
    all(...params: BindingArray | [BindingDictionary]): Record<string, SupportedValueType>[];
    /** Return expanded SQL string with bound values */
    expandedSQL: string;
    /** Return original SQL string */
    sourceSQL: string;
  }

  /** Synchronous SQLite database connection */
  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);

    /** Execute one or more SQL statements. Returns undefined. */
    exec(sql: string): void;

    /** Prepare a SQL statement for repeated execution. */
    prepare(sql: string): StatementSync;

    /** Close the database connection. */
    close(): void;

    /** Return true if the database connection is open. */
    readonly isOpen: boolean;
  }
}
