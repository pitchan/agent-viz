import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Erreur d'installation : message actionnable, le fichier fautif n'est JAMAIS modifié. */
export class InstallError extends Error {}

/** Garde de forme partagée : tout nœud traversé qui n'est pas un objet casse bruyamment. */
export function asObject(node: unknown, what: string): Record<string, unknown> {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new InstallError(`nœud de type inattendu : ${what} n'est pas un objet`);
  }
  return node as Record<string, unknown>;
}

export interface JsonFileRead {
  /** undefined si le fichier n'existe pas. */
  value: unknown;
  /** Indentation détectée dans le fichier (défaut : 2 espaces). */
  indent: string;
}

const DEFAULT_INDENT = '  ';

export function readJsonFile(filePath: string): JsonFileRead {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { value: undefined, indent: DEFAULT_INDENT };
    }
    throw err;
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // BOM U+FEFF (leçon v0.2.1)
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new InstallError(`JSON invalide dans ${filePath} : ${(err as Error).message}`);
  }
  const indent = /\n([ \t]+)\S/.exec(raw)?.[1] ?? DEFAULT_INDENT;
  return { value, indent };
}

/** Écriture atomique (temp + rename même volume), indentation imposée, \n final, sans BOM. */
export function writeJsonFileAtomic(filePath: string, value: unknown, indent: string = DEFAULT_INDENT): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.netgain-tmp-${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, indent)}\n`);
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
}
