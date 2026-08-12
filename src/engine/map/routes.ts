import ts from 'typescript';
import { lineOf, parseProject, type ParseFailure } from './engine.js';

export type RouteFramework = 'nestjs' | 'express' | 'angular' | 'next';

export interface RouteFact {
  framework: RouteFramework;
  /** Verbe HTTP, ou null pour les routes Angular (navigation, pas HTTP). */
  method: string | null;
  path: string;
  file: string;
  line: number;
  guards: string[];
  provenance: 'ast';
  /**
   * Express seulement : préfixe de montage. null = route directe sur app ;
   * string = mount résolu dans le même fichier (le path est déjà complet) ;
   * 'unknown' = router monté ailleurs — le path reste local, jamais inventé.
   */
  mountedAt?: string | 'unknown' | null;
  /** Angular seulement : composant ciblé, ou 'lazy' (loadComponent/loadChildren). */
  target?: string;
  /** Angular seulement : route déclarée derrière un ternaire (feature flag) — présente dans le code, activée à l'exécution. */
  conditional?: true;
}

export interface RoutesReport {
  routes: RouteFact[];
  failures: ParseFailure[];
}

const NEST_HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options', 'Search']);

/** Jointure de segments avec exactement un `/` entre chaque, `/` si vide. */
function joinPath(...segments: string[]): string {
  const parts = segments.map((s) => s.replace(/^\/+|\/+$/g, '')).filter((s) => s.length > 0);
  return `/${parts.join('/')}`;
}

interface DecoratorCall {
  name: string;
  args: readonly ts.Expression[];
  node: ts.Decorator;
}

function decoratorCalls(node: ts.HasDecorators): DecoratorCall[] {
  const calls: DecoratorCall[] = [];
  for (const dec of ts.getDecorators(node) ?? []) {
    if (ts.isCallExpression(dec.expression) && ts.isIdentifier(dec.expression.expression)) {
      calls.push({ name: dec.expression.expression.text, args: dec.expression.arguments, node: dec });
    }
  }
  return calls;
}

function firstStringArg(args: readonly ts.Expression[]): string {
  const first = args[0];
  return first !== undefined && ts.isStringLiteralLike(first) ? first.text : '';
}

function guardNames(calls: DecoratorCall[], source: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const call of calls) {
    if (call.name !== 'UseGuards') continue;
    for (const arg of call.args) names.push(ts.isIdentifier(arg) ? arg.text : arg.getText(source));
  }
  return names;
}

function extractNestRoutes(source: ts.SourceFile, relPath: string, routes: RouteFact[]): void {
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && ts.canHaveDecorators(node)) {
      const classCalls = decoratorCalls(node);
      const controller = classCalls.find((c) => c.name === 'Controller');
      if (controller !== undefined) {
        const prefix = firstStringArg(controller.args);
        const classGuards = guardNames(classCalls, source);
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || !ts.canHaveDecorators(member)) continue;
          const methodCalls = decoratorCalls(member);
          const http = methodCalls.find((c) => NEST_HTTP_DECORATORS.has(c.name));
          if (http === undefined) continue;
          routes.push({
            framework: 'nestjs',
            method: http.name.toUpperCase(),
            path: joinPath(prefix, firstStringArg(http.args)),
            file: relPath,
            line: lineOf(source, member),
            guards: [...classGuards, ...guardNames(methodCalls, source)],
            provenance: 'ast',
          });
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
}

const EXPRESS_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'head', 'options']);
const EXPRESS_APP_TYPES = new Set(['Application', 'Express']);

/** `express()` ou `express.Router()` / `Router()`. */
function expressInitKind(init: ts.Expression): 'app' | 'router' | null {
  if (!ts.isCallExpression(init)) return null;
  const callee = init.expression;
  if (ts.isIdentifier(callee) && callee.text === 'express') return 'app';
  if (ts.isIdentifier(callee) && callee.text === 'Router') return 'router';
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'Router') return 'router';
  return null;
}

/** Imports du module 'express' : nom local → nom d'origine ('*' = namespace/défaut). */
function expressImportMap(source: ts.SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteralLike(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== 'express') continue;
    const clause = stmt.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) imports.set(clause.name.text, '*');
    if (clause.namedBindings !== undefined) {
      if (ts.isNamespaceImport(clause.namedBindings)) imports.set(clause.namedBindings.name.text, '*');
      else for (const spec of clause.namedBindings.elements) imports.set(spec.name.text, (spec.propertyName ?? spec.name).text);
    }
  }
  return imports;
}

/** Kind express d'un type annoté — seulement s'il vient RÉELLEMENT du module 'express'. */
function expressTypeKind(type: ts.TypeNode | undefined, imports: Map<string, string>): 'app' | 'router' | null {
  if (type === undefined || !ts.isTypeReferenceNode(type)) return null;
  const name = type.typeName;
  let original: string | undefined;
  if (ts.isIdentifier(name)) {
    const mapped = imports.get(name.text);
    if (mapped !== undefined && mapped !== '*') original = mapped;
  } else if (ts.isQualifiedName(name) && ts.isIdentifier(name.left) && imports.get(name.left.text) === '*') {
    original = name.right.text;
  }
  if (original === undefined) return null;
  if (EXPRESS_APP_TYPES.has(original)) return 'app';
  return original === 'Router' ? 'router' : null;
}

function enclosingClass(node: ts.Node): ts.Node | null {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) return n;
  }
  return null;
}

interface ThisPropRouteInfo {
  typeKind: 'app' | 'router' | null;
  assignKind: 'app' | 'router' | null;
  assignments: number;
}

/**
 * Liaisons this.propriété → app/router, par classe (patron J1-fix2) : type
 * express déclaré (propriété ou paramètre de constructeur), ou assignation
 * `this.x = express()/Router()` — valable seulement si assignée UNE fois.
 */
function collectThisPropKinds(source: ts.SourceFile, imports: Map<string, string>): Map<ts.Node, Map<string, ThisPropRouteInfo>> {
  const byClass = new Map<ts.Node, Map<string, ThisPropRouteInfo>>();
  const info = (cls: ts.Node, prop: string): ThisPropRouteInfo => {
    const props = byClass.get(cls) ?? new Map<string, ThisPropRouteInfo>();
    byClass.set(cls, props);
    const existing = props.get(prop) ?? { typeKind: null, assignKind: null, assignments: 0 };
    props.set(prop, existing);
    return existing;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const member of node.members) {
        if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
          const kind = expressTypeKind(member.type, imports) ?? (member.initializer !== undefined ? expressInitKind(member.initializer) : null);
          if (kind !== null) info(node, member.name.text).typeKind = kind;
        }
        if (ts.isConstructorDeclaration(member)) {
          for (const param of member.parameters) {
            if (!ts.isParameterPropertyDeclaration(param, member) || !ts.isIdentifier(param.name)) continue;
            const kind = expressTypeKind(param.type, imports);
            if (kind !== null) info(node, param.name.text).typeKind = kind;
          }
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const cls = enclosingClass(node);
      if (cls !== null) {
        const entry = info(cls, node.left.name.text);
        entry.assignments += 1;
        const kind = expressInitKind(node.right);
        if (kind !== null) entry.assignKind = kind;
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return byClass;
}

/** Kind effectif d'une liaison : le type prime ; l'assignation ne vaut que si unique. */
function effectiveThisPropKind(entry: ThisPropRouteInfo | undefined): 'app' | 'router' | null {
  if (entry === undefined) return null;
  if (entry.typeKind !== null) return entry.typeKind;
  return entry.assignments === 1 ? entry.assignKind : null;
}

/** Membre destructuré d'un paramètre options : nom local → (interface, membre). */
interface DestructuredMember {
  typeName: string;
  member: string;
}

interface ExpressLexicalBindings {
  imports: Map<string, string>;
  /** Interfaces du fichier : nom → membres au type express. */
  ifaceKinds: Map<string, Map<string, 'app' | 'router'>>;
  /** Par fonction : nom local destructuré → membre d'interface à résoudre. */
  destructured: Map<ts.Node, Map<string, DestructuredMember>>;
}

/**
 * Liaison lexicale d'un identifiant : dans la fonction englobante la plus
 * proche qui déclare ce nom (paramètre typé, ou const destructurée d'un
 * paramètre options typé par une interface du même fichier), le type décide —
 * l'ombrage par un type non-express arrête la recherche ('shadowed').
 * null = aucun déclarant de ce nom sur le chemin.
 */
function lexicalReceiverKind(node: ts.Node, name: string, bindings: ExpressLexicalBindings): 'app' | 'router' | 'shadowed' | null {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (!ts.isFunctionLike(n)) continue;
    for (const param of n.parameters) {
      if (!ts.isIdentifier(param.name) || param.name.text !== name) continue;
      return expressTypeKind(param.type, bindings.imports) ?? 'shadowed';
    }
    const local = bindings.destructured.get(n)?.get(name);
    if (local !== undefined) {
      return bindings.ifaceKinds.get(local.typeName)?.get(local.member) ?? 'shadowed';
    }
  }
  return null;
}

/** Fonction englobante la plus proche, sinon null. */
function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | null {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (ts.isFunctionLike(n)) return n;
  }
  return null;
}

function extractExpressRoutes(source: ts.SourceFile, relPath: string, routes: RouteFact[]): void {
  if (!source.statements.some((s) => ts.isImportDeclaration(s) && ts.isStringLiteralLike(s.moduleSpecifier) && s.moduleSpecifier.text === 'express')) {
    return;
  }

  const imports = expressImportMap(source);
  const thisPropKinds = collectThisPropKinds(source, imports);
  const bindings: ExpressLexicalBindings = { imports, ifaceKinds: new Map(), destructured: new Map() };

  // Passe 1 : variables app/router, mounts locaux app.use(prefix, router),
  // interfaces locales et destructurations d'options typées.
  const kinds = new Map<string, 'app' | 'router'>();
  const mounts = new Map<string, string>(); // nom de router -> préfixe
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const kind = expressInitKind(node.initializer);
      if (kind !== null) kinds.set(node.name.text, kind);
    }
    if (ts.isInterfaceDeclaration(node)) {
      const members = new Map<string, 'app' | 'router'>();
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue;
        const kind = expressTypeKind(member.type, imports);
        if (kind !== null) members.set(member.name.text, kind);
      }
      if (members.size > 0) bindings.ifaceKinds.set(node.name.text, members);
    }
    // `const { app } = options` où options est un paramètre de la fonction
    // englobante typé par une interface (résolution différée, même fichier).
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer !== undefined && ts.isIdentifier(node.initializer)) {
      const fn = enclosingFunction(node);
      const param = fn?.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === (node.initializer as ts.Identifier).text);
      if (fn !== null && fn !== undefined && param?.type !== undefined && ts.isTypeReferenceNode(param.type) && ts.isIdentifier(param.type.typeName)) {
        const typeName = param.type.typeName.text;
        const locals = bindings.destructured.get(fn) ?? new Map<string, DestructuredMember>();
        for (const element of node.name.elements) {
          if (element.dotDotDotToken !== undefined || !ts.isIdentifier(element.name)) continue;
          const member = element.propertyName !== undefined && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
          locals.set(element.name.text, { typeName, member });
        }
        if (locals.size > 0) bindings.destructured.set(fn, locals);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'use' &&
      node.arguments.length >= 2 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      ts.isIdentifier(node.arguments[1]!)
    ) {
      mounts.set((node.arguments[1] as ts.Identifier).text, (node.arguments[0] as ts.StringLiteralLike).text);
    }
    node.forEachChild(collect);
  };
  collect(source);

  // Chemins du premier argument : string, ou tableau de strings (un fait par
  // chemin) — les éléments non-string (regex…) ne sont jamais inventés.
  const firstArgPaths = (arg: ts.Expression): string[] => {
    if (ts.isStringLiteralLike(arg)) return [arg.text];
    if (ts.isArrayLiteralExpression(arg)) return arg.elements.filter(ts.isStringLiteralLike).map((e) => e.text);
    return [];
  };

  // Passe 2 : X.METHOD('/path', ...) sur les variables/paramètres/options
  // liés, et this.X.METHOD('/path', ...) sur les propriétés liées de la
  // classe englobante.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && EXPRESS_METHODS.has(node.expression.name.text) && node.arguments.length > 0) {
      const target = node.expression.expression;
      let receiver: string | null = null;
      let kind: 'app' | 'router' | undefined;
      if (ts.isIdentifier(target)) {
        receiver = target.text;
        const lexical = lexicalReceiverKind(node, receiver, bindings);
        if (lexical === 'shadowed') kind = undefined;
        else if (lexical !== null) kind = lexical;
        else kind = kinds.get(receiver);
      } else if (ts.isPropertyAccessExpression(target) && target.expression.kind === ts.SyntaxKind.ThisKeyword) {
        receiver = target.name.text;
        const cls = enclosingClass(node);
        kind = effectiveThisPropKind(cls !== null ? thisPropKinds.get(cls)?.get(receiver) : undefined) ?? undefined;
      }
      if (receiver === null || kind === undefined) {
        node.forEachChild(visit);
        return;
      }
      for (const localPath of firstArgPaths(node.arguments[0]!)) {
        if (kind === 'app') {
          routes.push({
            framework: 'express',
            method: node.expression.name.text.toUpperCase(),
            path: localPath,
            file: relPath,
            line: lineOf(source, node),
            guards: [],
            provenance: 'ast',
            mountedAt: null,
          });
        } else {
          const mount = mounts.get(receiver);
          routes.push({
            framework: 'express',
            method: node.expression.name.text.toUpperCase(),
            path: mount !== undefined ? joinPath(mount, localPath) : localPath,
            file: relPath,
            line: lineOf(source, node),
            guards: [],
            provenance: 'ast',
            mountedAt: mount ?? 'unknown',
          });
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
}

const NEXT_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const NEXT_FILE_EXT = /\.(tsx|ts|jsx|js|mjs)$/;

/**
 * Segments sous le dossier app router (`app/` ou `src/app/` à la racine
 * scannée), sinon null. Le chemin URL ne vient QUE de l'arborescence.
 */
function nextAppSegments(relPath: string): string[] | null {
  const parts = relPath.split(/[\\/]/);
  if (parts[0] === 'app') return parts.slice(1);
  if (parts[0] === 'src' && parts[1] === 'app') return parts.slice(2);
  return null;
}

/** Exports de verbes HTTP d'un route.ts : function, const, ou ré-export nommé. */
function nextExportedMethods(source: ts.SourceFile): { method: string; node: ts.Node }[] {
  const out: { method: string; node: ts.Node }[] = [];
  for (const stmt of source.statements) {
    const isExported = ts.canHaveModifiers(stmt) && (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(stmt) && isExported && stmt.name !== undefined && NEXT_HTTP_METHODS.has(stmt.name.text)) {
      out.push({ method: stmt.name.text, node: stmt });
    } else if (ts.isVariableStatement(stmt) && isExported) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && NEXT_HTTP_METHODS.has(decl.name.text)) out.push({ method: decl.name.text, node: decl });
      }
    } else if (ts.isExportDeclaration(stmt) && stmt.exportClause !== undefined && ts.isNamedExports(stmt.exportClause)) {
      for (const spec of stmt.exportClause.elements) {
        if (NEXT_HTTP_METHODS.has(spec.name.text)) out.push({ method: spec.name.text, node: spec });
      }
    }
  }
  return out;
}

/** Nœud de l'export default d'une page, sinon undefined. */
function nextDefaultExport(source: ts.SourceFile): ts.Node | undefined {
  for (const stmt of source.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) return stmt;
    if (ts.canHaveModifiers(stmt)) {
      const mods = ts.getModifiers(stmt) ?? [];
      if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return stmt;
    }
    if (ts.isExportDeclaration(stmt) && stmt.exportClause !== undefined && ts.isNamedExports(stmt.exportClause)) {
      const def = stmt.exportClause.elements.find((s) => s.name.text === 'default');
      if (def !== undefined) return def;
    }
  }
  return undefined;
}

function extractNextRoutes(source: ts.SourceFile, relPath: string, routes: RouteFact[]): void {
  const segments = nextAppSegments(relPath);
  if (segments === null || segments.length === 0) return;
  const fileName = segments[segments.length - 1]!;
  if (!NEXT_FILE_EXT.test(fileName)) return;
  const base = fileName.replace(NEXT_FILE_EXT, '');
  if (base !== 'route' && base !== 'page') return;

  const dirSegments = segments.slice(0, -1);
  // Dossier privé _x : sous-arbre exclu du routage Next.
  if (dirSegments.some((s) => s.startsWith('_'))) return;
  // Groupes (x) et slots parallèles @x : présents sur disque, absents de l'URL.
  const urlPath = joinPath(...dirSegments.filter((s) => !(s.startsWith('(') && s.endsWith(')')) && !s.startsWith('@')));

  if (base === 'route') {
    for (const { method, node } of nextExportedMethods(source)) {
      routes.push({ framework: 'next', method, path: urlPath, file: relPath, line: lineOf(source, node), guards: [], provenance: 'ast' });
    }
  } else {
    const def = nextDefaultExport(source);
    if (def === undefined) return;
    routes.push({ framework: 'next', method: null, path: urlPath, file: relPath, line: lineOf(source, def), guards: [], provenance: 'ast' });
  }
}

/** Propriété d'un littéral objet par nom, sinon undefined. */
function objectProp(obj: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return obj.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && p.name.text === name,
  );
}

function angularGuards(obj: ts.ObjectLiteralExpression, source: ts.SourceFile): string[] {
  const prop = objectProp(obj, 'canActivate');
  if (prop === undefined || !ts.isArrayLiteralExpression(prop.initializer)) return [];
  return prop.initializer.elements.map((e) => (ts.isIdentifier(e) ? e.text : e.getText(source)));
}

function extractAngularRouteObject(
  obj: ts.ObjectLiteralExpression,
  parentPath: string,
  parentGuards: string[],
  source: ts.SourceFile,
  relPath: string,
  routes: RouteFact[],
  conditional = false,
): void {
  const pathProp = objectProp(obj, 'path');
  if (pathProp === undefined || !ts.isStringLiteralLike(pathProp.initializer)) return;
  const fullPath = joinPath(parentPath, pathProp.initializer.text);
  const guards = [...parentGuards, ...angularGuards(obj, source)];

  const component = objectProp(obj, 'component');
  const lazy = objectProp(obj, 'loadComponent') ?? objectProp(obj, 'loadChildren');
  const target =
    component !== undefined && ts.isIdentifier(component.initializer)
      ? component.initializer.text
      : lazy !== undefined
        ? 'lazy'
        : undefined;

  const children = objectProp(obj, 'children');
  if (children !== undefined && ts.isArrayLiteralExpression(children.initializer)) {
    for (const el of children.initializer.elements) {
      if (ts.isObjectLiteralExpression(el)) extractAngularRouteObject(el, fullPath, guards, source, relPath, routes, conditional);
    }
    // Un parent sans cible propre n'est qu'un groupe de children : pas une route.
    if (target === undefined) return;
  }

  routes.push({
    framework: 'angular',
    method: null,
    path: fullPath,
    file: relPath,
    line: lineOf(source, obj),
    guards,
    provenance: 'ast',
    ...(target !== undefined ? { target } : {}),
    ...(conditional ? { conditional: true as const } : {}),
  });
}

/**
 * Arrays de routes au premier niveau d'une expression (ternaire de feature
 * flag, spread…) — sans descendre dans les objets-routes eux-mêmes.
 */
function topLevelArrays(expr: ts.Node, out: ts.ArrayLiteralExpression[]): void {
  if (ts.isArrayLiteralExpression(expr)) {
    out.push(expr);
    return;
  }
  if (ts.isObjectLiteralExpression(expr)) return;
  expr.forEachChild((child) => topLevelArrays(child, out));
}

function extractAngularRoutes(source: ts.SourceFile, relPath: string, routes: RouteFact[]): void {
  const visit = (node: ts.Node): void => {
    // `const x: Routes = [...]` — ou toute expression (ternaire de feature
    // flag…) contenant des arrays de routes : extraits et marqués conditional,
    // jamais ignorés en silence.
    if (ts.isVariableDeclaration(node) && node.type !== undefined && node.initializer !== undefined) {
      const typeText = node.type.getText(source);
      if (typeText === 'Routes' || typeText === 'Route[]') {
        const plainArray = ts.isArrayLiteralExpression(node.initializer);
        const arrays: ts.ArrayLiteralExpression[] = [];
        topLevelArrays(node.initializer, arrays);
        for (const arr of arrays) {
          for (const el of arr.elements) {
            if (ts.isObjectLiteralExpression(el)) extractAngularRouteObject(el, '', [], source, relPath, routes, !plainArray);
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
}

/**
 * `map_routes` — surface de routes exacte (AST), scope : NestJS + Express +
 * Angular + Next app router. Chaque route porte `file:line` ; rien n'est inféré.
 */
export async function mapRoutes(root: string): Promise<RoutesReport> {
  const project = await parseProject(root);
  const routes: RouteFact[] = [];
  for (const { relPath, source } of project.files) {
    extractNestRoutes(source, relPath, routes);
    extractExpressRoutes(source, relPath, routes);
    extractAngularRoutes(source, relPath, routes);
    extractNextRoutes(source, relPath, routes);
  }
  routes.sort((a, b) => a.path.localeCompare(b.path) || (a.method ?? '').localeCompare(b.method ?? ''));
  return { routes, failures: project.failures };
}
