import path from 'node:path';
import ts from 'typescript';
import { parseProject, type ParseFailure, type ParsedProject } from './engine.js';

export interface ImpactEntry {
  file: string;
  depth: number;
}

export interface ImpactReport {
  target: string;
  direct: number;
  transitive: number;
  byDepth: Record<number, number>;
  dependents: ImpactEntry[];
  unresolvedImports: number;
  failures: ParseFailure[];
}

export interface HotEntry {
  file: string;
  importedBy: number;
}

export interface HotReport {
  files: HotEntry[];
  unresolvedImports: number;
  failures: ParseFailure[];
}

export class TargetNotFoundError extends Error {
  constructor(
    readonly target: string,
    readonly suggestions: string[],
  ) {
    super(`Cible introuvable dans la carte : ${target}${suggestions.length > 0 ? `. Candidats : ${suggestions.join(', ')}` : ''}`);
  }
}

export interface ModuleGraph {
  project: ParsedProject;
  /** relPath → relPaths des fichiers qui l'importent DIRECTEMENT. */
  importers: Map<string, Set<string>>;
  /**
   * Spécificateurs RELATIFS non résolus = vrais trous de carte (fichier
   * manquant, extension exotique). Les non-relatifs non résolus sont des
   * packages externes présumés (node_modules non scanné) et ne comptent pas.
   */
  unresolvedImports: number;
}

/** Toutes les arêtes d'import d'un fichier : statiques, export-from, import() dynamique, require(). */
function importSpecifiers(source: ts.SourceFile): string[] {
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specs.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]!)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) specs.push((node.arguments[0] as ts.StringLiteralLike).text);
    }
    node.forEachChild(visit);
  };
  visit(source);
  return specs;
}

interface TsconfigContext {
  dir: string;
  options: ts.CompilerOptions;
}

/** Clé de comparaison de chemins : séparateurs unifiés, casse neutralisée (FS Windows). */
function pathKey(p: string): string {
  return path.normalize(p).toLowerCase();
}

function loadTsconfigContexts(tsconfigPaths: string[], failures: ParseFailure[], root: string): TsconfigContext[] {
  const contexts: TsconfigContext[] = [];
  for (const cfgPath of tsconfigPaths) {
    const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (read.error !== undefined) {
      failures.push({ file: path.relative(root, cfgPath), message: ts.flattenDiagnosticMessageText(read.error.messageText, ' ') });
      continue;
    }
    const dir = path.dirname(cfgPath);
    // parseJsonConfigFileContent résout `extends` — la fidélité au projet scanné.
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir);
    contexts.push({ dir, options: parsed.options });
  }
  // Le plus profond d'abord : la résolution d'un fichier suit son tsconfig le plus proche.
  contexts.sort((a, b) => b.dir.length - a.dir.length);
  return contexts;
}

function optionsFor(fileAbs: string, contexts: TsconfigContext[]): ts.CompilerOptions {
  const key = pathKey(fileAbs);
  const ctx = contexts.find((c) => key.startsWith(pathKey(c.dir) + path.sep));
  const options: ts.CompilerOptions = { ...(ctx?.options ?? {}), allowJs: true };
  if (options.moduleResolution === undefined || options.moduleResolution === ts.ModuleResolutionKind.Classic) {
    options.moduleResolution = ts.ModuleResolutionKind.Node10;
  }
  return options;
}

/**
 * Graphe d'imports MODULE-LEVEL du repo : résolution exacte des spécificateurs
 * (relatifs, baseUrl, alias paths) par le compilateur TypeScript VENDORÉ et le
 * tsconfig le plus proche de chaque fichier. Les imports de packages externes
 * sont ignorés (isExternalLibraryImport / non-relatif non résolu).
 */
export async function buildModuleGraph(root: string): Promise<ModuleGraph> {
  const project = await parseProject(root);
  const contexts = loadTsconfigContexts(project.tsconfigs, project.failures, root);

  const relByAbs = new Map<string, string>();
  for (const f of project.files) relByAbs.set(pathKey(f.absPath), f.relPath);

  const importers = new Map<string, Set<string>>();
  let unresolvedImports = 0;

  for (const file of project.files) {
    const options = optionsFor(file.absPath, contexts);
    for (const spec of new Set(importSpecifiers(file.source))) {
      const resolved = ts.resolveModuleName(spec, file.absPath, options, ts.sys).resolvedModule;
      if (resolved !== undefined && !resolved.isExternalLibraryImport) {
        const rel = relByAbs.get(pathKey(resolved.resolvedFileName));
        if (rel !== undefined && rel !== file.relPath) {
          const set = importers.get(rel) ?? new Set<string>();
          set.add(file.relPath);
          importers.set(rel, set);
        }
        continue;
      }
      if (spec.startsWith('./') || spec.startsWith('../')) unresolvedImports += 1;
    }
  }

  return { project, importers, unresolvedImports };
}

const normSlash = (p: string): string => p.replaceAll('\\', '/');

/** Cible exacte, sinon suffixe non ambigu, sinon TargetNotFoundError avec candidats. */
function resolveTarget(project: ParsedProject, target: string): string {
  const wanted = normSlash(target).replace(/^\.\//, '').toLowerCase();
  const files = project.files.map((f) => f.relPath);

  const exact = files.find((f) => normSlash(f).toLowerCase() === wanted);
  if (exact !== undefined) return exact;

  const bySuffix = files.filter((f) => normSlash(f).toLowerCase().endsWith(`/${wanted}`));
  if (bySuffix.length === 1) return bySuffix[0]!;
  if (bySuffix.length > 1) throw new TargetNotFoundError(target, bySuffix);

  const basename = wanted.split('/').pop() ?? wanted;
  const byBasename = files.filter((f) => normSlash(f).toLowerCase().endsWith(`/${basename}`) || normSlash(f).toLowerCase() === basename);
  throw new TargetNotFoundError(target, byBasename);
}

/**
 * `map_impact` — blast radius EXACT d'un fichier : importeurs directs puis
 * dépendants transitifs (BFS inverse, profondeur = plus court chemin).
 */
export async function mapImpact(root: string, target: string): Promise<ImpactReport> {
  const graph = await buildModuleGraph(root);
  const resolved = resolveTarget(graph.project, target);

  const depths = new Map<string, number>([[resolved, 0]]);
  let frontier = [resolved];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const file of frontier) {
      const depth = depths.get(file)! + 1;
      for (const importer of graph.importers.get(file) ?? []) {
        if (!depths.has(importer)) {
          depths.set(importer, depth);
          next.push(importer);
        }
      }
    }
    frontier = next;
  }

  const dependents: ImpactEntry[] = [...depths.entries()]
    .filter(([, depth]) => depth > 0)
    .map(([file, depth]) => ({ file, depth }))
    .sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file));

  const byDepth: Record<number, number> = {};
  for (const d of dependents) byDepth[d.depth] = (byDepth[d.depth] ?? 0) + 1;

  return {
    target: resolved,
    direct: byDepth[1] ?? 0,
    transitive: dependents.length,
    byDepth,
    dependents,
    unresolvedImports: graph.unresolvedImports,
    failures: graph.project.failures,
  };
}

/** `map_hot` — fichiers les plus importés (importeurs DIRECTS, décroissant). */
export async function mapHot(root: string): Promise<HotReport> {
  const graph = await buildModuleGraph(root);
  const files: HotEntry[] = [...graph.importers.entries()]
    .map(([file, set]) => ({ file, importedBy: set.size }))
    .filter((e) => e.importedBy > 0)
    .sort((a, b) => b.importedBy - a.importedBy || a.file.localeCompare(b.file));
  return { files, unresolvedImports: graph.unresolvedImports, failures: graph.project.failures };
}
