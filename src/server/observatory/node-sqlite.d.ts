// Ambient shim for 'node:sqlite' — @types/node 20.x ships no declarations for
// it (TS2307), and this repo's engine tsconfig proved (sandbox, tsc 5.9.3)
// that a `declare module 'node:sqlite'` block placed INSIDE a regular .ts
// module is read as a module AUGMENTATION and rejected ("cannot be found"):
// only a standalone .d.ts is honoured as a fresh ambient declaration for a
// Node builtin specifier under NodeNext resolution.
//
// Scope: the exact surface store.ts (lot 6) actually calls — nothing more,
// same discipline as migrations.ts's local SqliteDb (lot 5).
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: Array<string | number | null>): { changes: number };
      get(...params: Array<string | number | null>): unknown;
      all(...params: Array<string | number | null>): unknown[];
    };
    close(): void;
  }
}
