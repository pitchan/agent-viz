import { readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface ParsedFile {
  absPath: string;
  /** Chemin relatif à la racine scannée, séparateurs natifs. */
  relPath: string;
  source: ts.SourceFile;
}

export interface ParseFailure {
  file: string;
  message: string;
}

export interface ParsedProject {
  root: string;
  files: ParsedFile[];
  failures: ParseFailure[];
  /** tsconfig.json rencontrés (chemins absolus) — pour la résolution de modules. */
  tsconfigs: string[];
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.angular', '.next']);
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];

function isSourceFile(name: string): boolean {
  if (name.endsWith('.d.ts')) return false;
  return EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Parse tous les fichiers TS/JS sous `root` avec le compilateur TypeScript
 * VENDORÉ (jamais celui du projet scanné). Lecture seule. Un fichier illisible
 * ou qui ne parse pas devient une entrée `failures` — jamais deviné.
 */
export async function parseProject(root: string): Promise<ParsedProject> {
  const files: ParsedFile[] = [];
  const failures: ParseFailure[] = [];
  const tsconfigs: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      failures.push({ file: path.relative(root, dir), message: String(err) });
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(abs);
        continue;
      }
      if (entry.isFile() && entry.name === 'tsconfig.json') {
        tsconfigs.push(abs);
        continue;
      }
      if (!entry.isFile() || !isSourceFile(entry.name)) continue;
      const relPath = path.relative(root, abs);
      try {
        const text = readFileSync(abs, 'utf8');
        const source = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, /* setParentNodes */ true);
        // parseDiagnostics est interne mais stable pour NOTRE version vendorée
        // (5.9.3 pinnée) : un fichier qui ne parse pas est refusé, jamais deviné.
        const diagnostics = (source as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
        if (diagnostics.length > 0) {
          const first = diagnostics[0]!;
          failures.push({ file: relPath, message: ts.flattenDiagnosticMessageText(first.messageText, ' ') });
          continue;
        }
        files.push({ absPath: abs, relPath, source });
      } catch (err) {
        failures.push({ file: relPath, message: String(err) });
      }
    }
  }

  await walk(root);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { root, files, failures, tsconfigs };
}

/** Ligne 1-based du début d'un nœud. */
export function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}
