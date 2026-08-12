import { budgetSlice } from '../map/budget.js';
import { mapEnv } from '../map/env.js';
import { mapHot, mapImpact } from '../map/graph.js';
import { mapHealth } from '../map/health.js';
import { mapRoutes } from '../map/routes.js';
import { readPackageVersion } from '../version.js';

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

export interface MapServerOptions {
  defaultRoot: string;
}

export interface MapServer {
  handle(message: JsonRpcMessage): Promise<Record<string, unknown> | null>;
}

interface ToolArgs {
  root?: string;
  offset?: number;
  limit?: number;
  target?: string;
}

/**
 * Les descriptions d'outils sont un LIVRABLE (spec §2.1) : c'est par elles que
 * l'agent choisit la bonne primitive au lieu d'explorer à la main. Versionnées,
 * à tester en régression sur le corpus de prompts J0.
 */
const TOOLS = [
  {
    name: 'map_env',
    description:
      "Variables d'environnement réellement lues/validées par le code (AST exact : process.env, throw-guards — y compris via liaisons const —, zod, Joi/@nestjs/config, envalid), avec file:line. `required` : true/false prouvé, 'unknown' = lue sans preuve, ou la condition portée (ex. 'NODE_ENV=production' = requise seulement en production). À utiliser AVANT de chercher à la main — jamais basé sur .env.example.",
  },
  {
    name: 'map_impact',
    description:
      "Blast radius EXACT d'un fichier (paramètre `target`, chemin relatif) : importeurs directs et dépendants transitifs par BFS sur le graphe d'imports résolu (import/export-from/import()/require, tsconfig baseUrl et alias paths), avec comptes par profondeur et nombre de routes impactées. À utiliser au lieu de remonter les imports à la main (Grep). Paginé ; toute coupe annotée « +N omitted ».",
  },
  {
    name: 'map_hot',
    description:
      'Les fichiers les plus importés du repo (nombre d\'importeurs DIRECTS, décroissant) = plus haut risque de changement. Graphe d\'imports exact, résolution tsconfig. Paginé ; toute coupe annotée « +N omitted ».',
  },
  {
    name: 'map_routes',
    description:
      "Surface de routes exacte du repo (NestJS, Express, Angular) : méthode, chemin complet, guards, file:line. Pour simplement ÉNUMÉRER des routes/décorateurs, un Grep ciblé de l'hôte est moins cher — n'appeler qu'en jointure avec le graphe d'imports (impact, dépendances) ou quand l'exactitude des guards/chemins complets compte. Paginé (offset) ; toute coupe est annotée « +N omitted ».",
  },
  {
    name: 'map_orient',
    description:
      "Orientation express du repo : combien de fichiers, quels frameworks de routes détectés, combien de routes/variables d'env, où sont les gros fichiers de routes. Premier appel recommandé sur un repo inconnu.",
  },
  {
    name: 'map_health',
    description:
      'Fraîcheur et honnêteté du scan : fichiers parsés, fichiers REFUSÉS (erreur de parse, avec message). Un fichier refusé ne produit jamais de faits — vérifier ici ce que la carte ne voit pas.',
  },
] as const;

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    root: { type: 'string', description: 'Racine du repo à scanner (défaut : racine configurée au lancement).' },
    offset: { type: 'number', description: 'Pagination : sauter les N premiers éléments.' },
    limit: { type: 'number', description: 'Nombre max d\'éléments (le budget de ~2 Ko s\'applique de toute façon).' },
    target: { type: 'string', description: 'map_impact : chemin relatif du fichier cible (ex. src/app/auth/auth.store.ts).' },
  },
  additionalProperties: false,
} as const;

function textResult(id: number | string | null | undefined, body: unknown, isError = false): Record<string, unknown> {
  const result: Record<string, unknown> = { content: [{ type: 'text', text: JSON.stringify(body) }] };
  if (isError) result.isError = true;
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export function createMapServer(options: MapServerOptions): MapServer {
  async function callTool(name: string, args: ToolArgs): Promise<unknown> {
    const root = args.root ?? options.defaultRoot;
    switch (name) {
      case 'map_env': {
        const report = await mapEnv(root);
        const slice = budgetSlice(report.facts, { offset: args.offset, limit: args.limit });
        return { env: slice.items, total: slice.total, omitted: slice.omitted, ...(slice.note !== undefined ? { note: slice.note } : {}), parseFailures: report.failures.length };
      }
      case 'map_routes': {
        const report = await mapRoutes(root);
        const slice = budgetSlice(report.routes, { offset: args.offset, limit: args.limit });
        return { routes: slice.items, total: slice.total, omitted: slice.omitted, ...(slice.note !== undefined ? { note: slice.note } : {}), parseFailures: report.failures.length };
      }
      case 'map_orient': {
        const [health, routes, env] = await Promise.all([mapHealth(root), mapRoutes(root), mapEnv(root)]);
        const byFramework: Record<string, number> = {};
        const byFile = new Map<string, number>();
        for (const r of routes.routes) {
          byFramework[r.framework] = (byFramework[r.framework] ?? 0) + 1;
          byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1);
        }
        const topRouteFiles = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([file, count]) => ({ file, routes: count }));
        return {
          root,
          filesParsed: health.filesParsed,
          parseFailures: health.parseFailures.length,
          routes: { total: routes.routes.length, byFramework },
          envVars: env.facts.length,
          topRouteFiles,
        };
      }
      case 'map_impact': {
        if (args.target === undefined || args.target === '') {
          throw new Error("paramètre 'target' requis : chemin relatif du fichier dont on veut le blast radius.");
        }
        const [report, routes] = await Promise.all([mapImpact(root, args.target), mapRoutes(root)]);
        const impactedFiles = new Set<string>([report.target, ...report.dependents.map((d) => d.file)]);
        const routesImpacted = routes.routes.filter((r) => impactedFiles.has(r.file)).length;
        // Budget réduit : l'enveloppe (byDepth, comptes, routes) dépasse la marge standard.
        const slice = budgetSlice(report.dependents, { offset: args.offset, limit: args.limit, budgetBytes: 1792 });
        return {
          target: report.target,
          direct: report.direct,
          transitive: report.transitive,
          byDepth: report.byDepth,
          routesImpacted,
          dependents: slice.items,
          total: slice.total,
          omitted: slice.omitted,
          ...(slice.note !== undefined ? { note: slice.note } : {}),
          unresolvedImports: report.unresolvedImports,
          parseFailures: report.failures.length,
        };
      }
      case 'map_hot': {
        const report = await mapHot(root);
        const slice = budgetSlice(report.files, { offset: args.offset, limit: args.limit, budgetBytes: 1920 });
        return {
          files: slice.items,
          total: slice.total,
          omitted: slice.omitted,
          ...(slice.note !== undefined ? { note: slice.note } : {}),
          unresolvedImports: report.unresolvedImports,
          parseFailures: report.failures.length,
        };
      }
      case 'map_health': {
        const health = await mapHealth(root);
        const slice = budgetSlice(health.parseFailures, { offset: args.offset, limit: args.limit });
        return { root: health.root, filesParsed: health.filesParsed, scannedAt: health.scannedAt, parseFailures: slice.items, total: slice.total, omitted: slice.omitted, ...(slice.note !== undefined ? { note: slice.note } : {}) };
      }
      default:
        throw new UnknownToolError(name);
    }
  }

  return {
    async handle(message: JsonRpcMessage): Promise<Record<string, unknown> | null> {
      const { id, method, params } = message;
      const isNotification = id === undefined;

      if (method === 'initialize') {
        const p = (params ?? {}) as { protocolVersion?: string };
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            protocolVersion: p.protocolVersion ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'netgain-map', version: readPackageVersion() },
          },
        };
      }
      if (method === 'ping') return isNotification ? null : { jsonrpc: '2.0', id: id ?? null, result: {} };
      if (method !== undefined && method.startsWith('notifications/')) return null;

      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: { tools: TOOLS.map((t) => ({ ...t, inputSchema: INPUT_SCHEMA })) },
        };
      }

      if (method === 'tools/call') {
        const p = (params ?? {}) as { name?: string; arguments?: ToolArgs };
        try {
          const body = await callTool(p.name ?? '', p.arguments ?? {});
          return textResult(id, body);
        } catch (err) {
          if (err instanceof UnknownToolError) {
            return textResult(id, `Outil inconnu : ${err.toolName}. Outils disponibles : ${TOOLS.map((t) => t.name).join(', ')}.`, true);
          }
          return textResult(id, `Échec ${p.name ?? '?'} : ${String(err)}`, true);
        }
      }

      if (isNotification) return null;
      return { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `Méthode inconnue : ${method ?? '(absente)'}` } };
    },
  };
}

class UnknownToolError extends Error {
  constructor(readonly toolName: string) {
    super(`unknown tool: ${toolName}`);
  }
}
