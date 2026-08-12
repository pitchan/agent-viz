import ts from 'typescript';
import { lineOf, parseProject, type ParseFailure } from './engine.js';

export type EnvKind = 'direct' | 'throw' | 'zod' | 'joi' | 'envalid' | 'nestjs-config';

export interface EnvFact {
  name: string;
  file: string;
  line: number;
  kind: EnvKind;
  /**
   * true/false = prouvé par AST ; 'unknown' = lue sans preuve d'exigence ;
   * 'VAR=valeur' (ex. 'NODE_ENV=production') = throw prouvé SOUS cette
   * condition — jamais un `true` sec pour un throw conditionnel.
   */
  required: boolean | string;
  provenance: 'ast';
}

export interface EnvReport {
  facts: EnvFact[];
  failures: ParseFailure[];
}

/**
 * Le plus fort gagne en dédup : preuve d'exigence > simple lecture. Un throw
 * CONDITIONNEL (required 'VAR=valeur') prouve moins qu'un schéma de validation
 * inconditionnel : il se classe sous zod/joi/envalid, au-dessus des lectures.
 */
const KIND_RANK: Record<EnvKind, number> = { throw: 5, zod: 4, joi: 4, envalid: 4, 'nestjs-config': 2, direct: 1 };

function rankOf(fact: EnvFact): number {
  if (fact.kind === 'throw' && fact.required !== true) return 3;
  return KIND_RANK[fact.kind];
}

/** `process.env` exactement (Identifier.process → .env). */
function isProcessEnv(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    node.name.text === 'env'
  );
}

/** Nom de variable pour `process.env.X` ou `process.env['X']`, sinon null. */
function envVarName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) return node.name.text;
  if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

/** `<...configService>.get('X')` — lecture env via @nestjs/config, sinon null. */
function configServiceGetName(expr: ts.Node): string | null {
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === 'get' &&
    /configservice$/i.test(lastName(expr.expression.expression) ?? '') &&
    expr.arguments.length > 0 &&
    ts.isStringLiteralLike(expr.arguments[0]!)
  ) {
    return (expr.arguments[0] as ts.StringLiteralLike).text;
  }
  return null;
}

/**
 * Lecture env pour une PREUVE d'exigence : `process.env.X`, ou
 * `configService.get('X')` dont l'éventuel défaut (2e argument) est un
 * littéral FALSY — un défaut truthy rend la valeur jamais falsy, la garde
 * `if (!x)` est inerte et on n'affirme rien.
 */
function envReadName(expr: ts.Node): string | null {
  const direct = envVarName(expr);
  if (direct !== null) return direct;
  const csName = configServiceGetName(expr);
  if (csName === null) return null;
  const call = expr as ts.CallExpression;
  if (call.arguments.length > 1 && !isFalsyLiteral(stripParens(call.arguments[1] as ts.Expression))) return null;
  return csName;
}

function isFalsyLiteral(e: ts.Expression): boolean {
  if (ts.isStringLiteralLike(e)) return e.text === '';
  if (ts.isNumericLiteral(e)) return Number(e.text) === 0;
  return (
    e.kind === ts.SyntaxKind.NullKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(e) && e.text === 'undefined')
  );
}

/**
 * Retire les fallbacks `|| <littéral FALSY>` ('' , 0, null…) : ils ne changent
 * pas la truthiness, une garde `if (!x)` reste atteignable. Un défaut truthy
 * (ou non-littéral) rend la garde inerte ou indécidable → null, on ne lie pas.
 */
function stripFalsyFallback(expr: ts.Expression): ts.Expression | null {
  let e = stripParens(expr);
  while (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    if (!isFalsyLiteral(stripParens(e.right))) return null;
    e = stripParens(e.left);
  }
  return e;
}

/** Lecture env d'un initialiseur de liaison, fallbacks falsy tolérés. */
function bindingEnvName(init: ts.Expression): string | null {
  const e = stripFalsyFallback(init);
  return e === null ? null : envReadName(e);
}

/** Liaison locale `const v = <lecture env>` — le dataflow LOCAL des gardes. */
interface EnvBinding {
  envName: string;
  /** Portée lexicale de la déclaration (fonction englobante ou fichier). */
  scope: ts.Node;
  /** Position de la déclaration : une liaison ne vaut qu'APRÈS elle. */
  start: number;
}

/** Initialiseur d'une `const` quelconque — pour résoudre les conditions liées. */
interface ConstInit {
  init: ts.Expression;
  scope: ts.Node;
  start: number;
}

/**
 * Propriété de classe : liaison `this.prop = <lecture env>` valable dans TOUTE
 * la classe (le constructeur s'exécute avant les méthodes), mais seulement si
 * la propriété n'est assignée qu'UNE fois — sinon on ne sait plus sa valeur.
 */
interface ThisPropInfo {
  envName: string | null;
  assignments: number;
}

interface FileBindings {
  envBindings: Map<string, EnvBinding[]>;
  constInits: Map<string, ConstInit[]>;
  thisProps: Map<ts.Node, Map<string, ThisPropInfo>>;
}

function isAncestorOrSelf(ancestor: ts.Node, node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n !== undefined; n = n.parent) {
    if (n === ancestor) return true;
  }
  return false;
}

function enclosingScope(node: ts.Node): ts.Node {
  let n: ts.Node | undefined = node.parent;
  while (n !== undefined && !ts.isFunctionLike(n) && !ts.isSourceFile(n)) n = n.parent;
  return n ?? node.getSourceFile();
}

function enclosingClass(node: ts.Node): ts.Node | null {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) return n;
  }
  return null;
}

function isThisProp(node: ts.Node): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword;
}

/** Toutes les liaisons du fichier en une passe : const env, const inits, this.prop. */
function collectFileBindings(source: ts.SourceFile): FileBindings {
  const envBindings = new Map<string, EnvBinding[]>();
  const constInits = new Map<string, ConstInit[]>();
  const thisProps = new Map<ts.Node, Map<string, ThisPropInfo>>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const) !== 0
    ) {
      const scope = enclosingScope(node);
      const start = node.getStart(source);
      const inits = constInits.get(node.name.text) ?? [];
      inits.push({ init: node.initializer, scope, start });
      constInits.set(node.name.text, inits);
      const envName = bindingEnvName(node.initializer);
      if (envName !== null) {
        const list = envBindings.get(node.name.text) ?? [];
        list.push({ envName, scope, start });
        envBindings.set(node.name.text, list);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && isThisProp(node.left)) {
      const cls = enclosingClass(node);
      if (cls !== null) {
        const props = thisProps.get(cls) ?? new Map<string, ThisPropInfo>();
        const info = props.get(node.left.name.text) ?? { envName: null, assignments: 0 };
        info.assignments += 1;
        const envName = bindingEnvName(node.right);
        if (envName !== null) info.envName = envName;
        props.set(node.left.name.text, info);
        thisProps.set(cls, props);
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return { envBindings, constInits, thisProps };
}

/** L'entrée visible à cet endroit (déclarée avant, dans une portée englobante), sinon null. */
function visibleEntry<T extends { scope: ts.Node; start: number }>(entries: Map<string, T[]>, id: ts.Identifier): T | null {
  const list = entries.get(id.text);
  if (list === undefined) return null;
  let best: T | null = null;
  for (const b of list) {
    if (b.start >= id.getStart()) continue;
    if (!isAncestorOrSelf(b.scope, id)) continue;
    if (best === null || b.start > best.start) best = b;
  }
  return best;
}

/** Nom env d'un accès `this.prop` lié (classe englobante, assignée une seule fois). */
function thisPropEnvName(thisProps: FileBindings['thisProps'], node: ts.Node): string | null {
  if (!isThisProp(node)) return null;
  const cls = enclosingClass(node);
  if (cls === null) return null;
  const info = thisProps.get(cls)?.get(node.name.text);
  return info !== undefined && info.assignments === 1 ? info.envName : null;
}

function stripParens(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

type ResolveEnvName = (expr: ts.Expression) => string | null;

/** Résolution partagée par les gardes : lectures env ET initialiseurs de const. */
interface ResolveCtx {
  resolveEnvName: ResolveEnvName;
  constInitOf: (id: ts.Identifier) => ts.Expression | null;
}

/** Garde-fou contre les auto-références (`const a = a === 'x'`) : la position
 * seule ne suffit pas, l'identifiant DANS l'initialiseur est après le début
 * de sa propre déclaration. */
const MAX_CONDITION_DEPTH = 8;

/**
 * Décompose une expression de garde en conditions RECONNUES, chacune de la
 * forme `<lecture env> === '<littéral>'` → 'VAR=valeur' (conjonctions `&&`
 * aplaties, identifiants const résolus vers leur initialiseur). Une seule
 * branche non reconnue → null : on ne porte jamais une condition qu'on ne
 * sait pas lire.
 */
function conditionOf(expr: ts.Expression, ctx: ResolveCtx, depth = 0): string[] | null {
  if (depth > MAX_CONDITION_DEPTH) return null;
  const e = stripParens(expr);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const left = conditionOf(e.left, ctx, depth + 1);
    const right = conditionOf(e.right, ctx, depth + 1);
    return left !== null && right !== null ? [...left, ...right] : null;
  }
  if (
    ts.isBinaryExpression(e) &&
    (e.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || e.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
  ) {
    for (const [envSide, litSide] of [
      [e.left, e.right],
      [e.right, e.left],
    ] as const) {
      const name = ctx.resolveEnvName(stripParens(envSide));
      if (name !== null && ts.isStringLiteralLike(stripParens(litSide))) {
        return [`${name}=${(stripParens(litSide) as ts.StringLiteralLike).text}`];
      }
    }
    return null;
  }
  if (ts.isIdentifier(e)) {
    const init = ctx.constInitOf(e);
    if (init !== null) return conditionOf(init, ctx, depth + 1);
  }
  return null;
}

/**
 * Un throw PROUVÉ atteignable depuis `stmt` : les ifs intermédiaires gatent
 * (conditions reconnues exigées), une branche else, un try/catch avaleur ou
 * une frontière de fonction rendent le throw non prouvé. Retour : [] = throw
 * inconditionnel, conditions sinon, null = aucun throw prouvable.
 */
function provenThrowConditions(stmt: ts.Statement, ctx: ResolveCtx): string[] | null {
  const throws: ts.ThrowStatement[] = [];
  const collect = (n: ts.Node): void => {
    if (ts.isThrowStatement(n)) throws.push(n);
    else if (!ts.isFunctionLike(n)) n.forEachChild(collect);
  };
  collect(stmt);

  let best: string[] | null = null;
  for (const t of throws) {
    const conditions: string[] = [];
    let proven = true;
    let child: ts.Node = t;
    for (let p: ts.Node | undefined = t.parent; p !== undefined && proven; child = p, p = p.parent) {
      if (ts.isIfStatement(p)) {
        if (child !== p.thenStatement) {
          proven = false;
          break;
        }
        const c = conditionOf(p.expression, ctx);
        if (c === null) {
          proven = false;
          break;
        }
        conditions.push(...c);
      }
      if (ts.isTryStatement(p) && child === p.tryBlock && p.catchClause !== undefined) {
        proven = false;
        break;
      }
      if (p === stmt) break;
    }
    if (!proven) continue;
    if (conditions.length === 0) return [];
    if (best === null || conditions.length < best.length) best = conditions;
  }
  return best;
}

/**
 * Le nœud (accès `process.env.X` ou identifiant lié) est-il prouvé
 * « throw si absent » ? Retour : null = non prouvé ; [] = inconditionnel ;
 * sinon les conditions qui gatent le throw ('NODE_ENV=production'…), portées
 * depuis les conjonctions `&&`, les ifs imbriqués DANS la garde et les ifs
 * ANCÊTRES jusqu'à la frontière de fonction. Tout élément non reconnu → null.
 */
function throwGuardConditions(access: ts.Node, ctx: ResolveCtx): string[] | null {
  let existenceFound = false;
  const gating: ts.Expression[] = [];
  let guardIf: ts.IfStatement | null = null;

  let child: ts.Node = access;
  for (let p: ts.Node | undefined = access.parent; p !== undefined; child = p, p = p.parent) {
    if (!existenceFound) {
      if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) existenceFound = true;
      else if (
        ts.isBinaryExpression(p) &&
        (p.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || p.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
      ) {
        const otherText = (child === p.left ? p.right : p.left).getText();
        if (otherText === 'undefined' || otherText === 'null') existenceFound = true;
      }
    } else if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      // Au-dessus du check d'existence : `cond && !x` → cond gate le throw.
      // À travers un `||` (`!u || !k`), le check seul suffit : rien à porter.
      gating.push(child === p.left ? p.right : p.left);
    }
    if (ts.isIfStatement(p)) {
      if (child === p.expression && existenceFound) guardIf = p;
      break;
    }
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) break;
  }
  if (guardIf === null) return null;

  const conditions: string[] = [];
  for (const g of gating) {
    const c = conditionOf(g, ctx);
    if (c === null) return null;
    conditions.push(...c);
  }

  const inner = provenThrowConditions(guardIf.thenStatement, ctx);
  if (inner === null) return null;
  conditions.push(...inner);

  let c2: ts.Node = guardIf;
  for (let p: ts.Node | undefined = guardIf.parent; p !== undefined; c2 = p, p = p.parent) {
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) break;
    if (ts.isIfStatement(p)) {
      if (c2 !== p.thenStatement) return null;
      const c = conditionOf(p.expression, ctx);
      if (c === null) return null;
      conditions.push(...c);
    }
    if (ts.isTryStatement(p) && c2 === p.tryBlock && p.catchClause !== undefined) return null;
  }

  return [...new Set(conditions)];
}

/** Le fichier importe-t-il `moduleName` (ou un sous-chemin) ? */
function importsFrom(source: ts.SourceFile, moduleName: string): boolean {
  return source.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteralLike(s.moduleSpecifier) &&
      (s.moduleSpecifier.text === moduleName || s.moduleSpecifier.text.startsWith(`${moduleName}/`)),
  );
}

/** Dernier identifiant d'une chaîne d'accès (`this.configService` → configService). */
function lastName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

/** Premier appel `X.object({...})` du sous-arbre → littéral objet du schéma, sinon null. */
function findObjectSchemaLiteral(node: ts.Node): ts.ObjectLiteralExpression | null {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'object' &&
    node.arguments.length > 0 &&
    ts.isObjectLiteralExpression(node.arguments[0]!)
  ) {
    return node.arguments[0] as ts.ObjectLiteralExpression;
  }
  let found: ts.ObjectLiteralExpression | null = null;
  node.forEachChild((child) => {
    if (found === null) found = findObjectSchemaLiteral(child);
  });
  return found;
}

/** Déclaration locale `const X = ...` du même fichier, sinon null. */
function localInitializer(source: ts.SourceFile, name: string): ts.Expression | null {
  let found: ts.Expression | null = null;
  const visit = (node: ts.Node): void => {
    if (found === null && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer !== undefined) {
      found = node.initializer;
    }
    if (found === null) node.forEachChild(visit);
  };
  visit(source);
  return found;
}

interface SchemaKey {
  name: string;
  node: ts.Node;
  valueText: string;
}

function schemaKeys(obj: ts.ObjectLiteralExpression, source: ts.SourceFile): SchemaKey[] {
  const keys: SchemaKey[] = [];
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name) ? prop.name.text : null;
    if (name === null) continue;
    keys.push({ name, node: prop, valueText: prop.initializer.getText(source) });
  }
  return keys;
}

/**
 * `map_env` — variables d'environnement lues/validées par le code, provenance
 * AST uniquement (jamais .env.example). Un fait par variable : le plus fort
 * gagne (preuve d'exigence > lecture nue).
 */
export async function mapEnv(root: string): Promise<EnvReport> {
  const project = await parseProject(root);
  const byName = new Map<string, EnvFact>();

  const record = (fact: EnvFact): void => {
    const existing = byName.get(fact.name);
    if (existing === undefined || rankOf(fact) > rankOf(existing)) byName.set(fact.name, fact);
  };

  for (const { relPath, source } of project.files) {
    const usesZod = importsFrom(source, 'zod');
    const usesEnvalid = importsFrom(source, 'envalid');
    const { envBindings: bindings, constInits, thisProps } = collectFileBindings(source);
    const resolveEnvName: ResolveEnvName = (expr) => {
      const direct = envReadName(expr);
      if (direct !== null) return direct;
      if (ts.isIdentifier(expr)) return visibleEntry(bindings, expr)?.envName ?? null;
      return null;
    };
    const ctx: ResolveCtx = {
      resolveEnvName,
      constInitOf: (id) => visibleEntry(constInits, id)?.init ?? null,
    };
    const requiredOf = (conditions: string[]): boolean | string => (conditions.length === 0 ? true : conditions.join(' && '));

    const recordSchema = (obj: ts.ObjectLiteralExpression, kind: EnvKind, isRequired: (valueText: string) => boolean): void => {
      for (const key of schemaKeys(obj, source)) {
        record({
          name: key.name,
          file: relPath,
          line: lineOf(source, key.node),
          kind,
          required: isRequired(key.valueText),
          provenance: 'ast',
        });
      }
    };

    const visit = (node: ts.Node): void => {
      // Accès directs et throw-guards (condition portée le cas échéant)
      const name = envVarName(node);
      if (name !== null) {
        const conditions = throwGuardConditions(node, ctx);
        record({
          name,
          file: relPath,
          line: lineOf(source, node),
          kind: conditions !== null ? 'throw' : 'direct',
          required: conditions !== null ? requiredOf(conditions) : 'unknown',
          provenance: 'ast',
        });
      }

      // Identifiants liés à une lecture env (const v = <lecture env>) gardés par throw
      if (
        ts.isIdentifier(node) &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) &&
        !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
      ) {
        const binding = visibleEntry(bindings, node);
        if (binding !== null) {
          const conditions = throwGuardConditions(node, ctx);
          if (conditions !== null) {
            record({
              name: binding.envName,
              file: relPath,
              line: lineOf(source, node),
              kind: 'throw',
              required: requiredOf(conditions),
              provenance: 'ast',
            });
          }
        }
      }

      // Propriétés this.prop liées à une lecture env (assignée UNE fois) gardées par throw
      {
        const envName = thisPropEnvName(thisProps, node);
        if (envName !== null) {
          const conditions = throwGuardConditions(node, ctx);
          if (conditions !== null) {
            record({
              name: envName,
              file: relPath,
              line: lineOf(source, node),
              kind: 'throw',
              required: requiredOf(conditions),
              provenance: 'ast',
            });
          }
        }
      }

      if (ts.isCallExpression(node)) {
        // zod : <schema>.parse(process.env) / safeParse
        if (
          usesZod &&
          ts.isPropertyAccessExpression(node.expression) &&
          (node.expression.name.text === 'parse' || node.expression.name.text === 'safeParse') &&
          node.arguments.length > 0 &&
          isProcessEnv(node.arguments[0]!)
        ) {
          const receiver = node.expression.expression;
          const schemaSource = ts.isIdentifier(receiver) ? localInitializer(source, receiver.text) : receiver;
          const obj = schemaSource === null ? null : findObjectSchemaLiteral(schemaSource);
          if (obj !== null) {
            recordSchema(obj, 'zod', (v) => !/\.(optional|default|nullish|catch)\s*\(/.test(v));
          }
        }

        // envalid : cleanEnv(process.env, {...})
        if (
          usesEnvalid &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'cleanEnv' &&
          node.arguments.length >= 2 &&
          isProcessEnv(node.arguments[0]!) &&
          ts.isObjectLiteralExpression(node.arguments[1]!)
        ) {
          recordSchema(node.arguments[1] as ts.ObjectLiteralExpression, 'envalid', (v) => !/\b(default|devDefault)\s*:/.test(v));
        }

        // NestJS : configService.get('X') — lecture toujours enregistrée ;
        // garde-throw seulement si la lecture est PROUVABLE (défaut falsy).
        const csName = configServiceGetName(node);
        if (csName !== null) {
          const conditions = envReadName(node) !== null ? throwGuardConditions(node, ctx) : null;
          record({
            name: csName,
            file: relPath,
            line: lineOf(source, node),
            kind: conditions !== null ? 'throw' : 'nestjs-config',
            required: conditions !== null ? requiredOf(conditions) : 'unknown',
            provenance: 'ast',
          });
        }
      }

      // Joi via validationSchema (ConfigModule.forRoot)
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'validationSchema') {
        const obj = findObjectSchemaLiteral(node.initializer);
        if (obj !== null) {
          recordSchema(obj, 'joi', (v) => /\.required\s*\(/.test(v));
        }
      }

      node.forEachChild(visit);
    };
    visit(source);
  }

  const facts = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { facts, failures: project.failures };
}
