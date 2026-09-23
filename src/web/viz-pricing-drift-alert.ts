// viz-pricing-drift-alert.ts — l'alerte que la vigie tarifaire lève dans l'onglet.
//
// Module pur : la dérive arrive par le flux SSE (message `pricingDrift`, branché
// sur `onPricingDrift` dans src/server/server.ts), l'horloge arrive en paramètre.
// Une dérive est un état hors session : `sessionId` vide dit « personne à nommer ».

// Clauses entières en `import type` : le serveur les efface au service, et le
// navigateur ne demande jamais src/server/pricing.ts.
import type { Drift } from '../server/pricing.ts';
import type { LiveAlert } from './viz-watchdog-client.ts';
import { ratesPerMTok } from './observatory/format.ts';

// Une phrase par nature de dérive. Un `kind` ajouté côté serveur sans sa
// phrase ici ne compile pas.
const WORDING: Record<Drift['kind'], (model: string) => string> = {
  'modele-nouveau': m => `Vigie tarifaire : ${m} existe chez LiteLLM mais pas dans la table embarquée`,
  'tarif-different': m => `Vigie tarifaire : le tarif de ${m} diffère entre LiteLLM et la table embarquée`,
};

// L'id est stable par modèle : la déduplication du registre externe (même id
// actif, pas de nouvelle sonnerie) repose dessus. Les chaînes vides sont celles
// que le détecteur pose pour « rien » : aucun agent, commande, projet ni motif.
export function pricingDriftAlert(d: Pick<Drift, 'model' | 'kind' | 'litellm' | 'embedded'>, receivedAt: number): LiveAlert {
  return {
    id: `pricingDrift:${d.model}`,
    type: 'pricingDrift',
    sessionId: '', agentId: '', agentType: '', cwd: '',
    toolName: d.model,
    // Les quatre prix se lisent avant le clic « Adopter » : c'est ce clic qui les rend comptables.
    subject: `LiteLLM, $ par million : ${ratesPerMTok(d.litellm)}${d.embedded ? ` — embarqué : ${ratesPerMTok(d.embedded)}` : ''}`,
    patternId: '',
    count: 1,
    // L'instant où l'onglet a reçu le rapport : le serveur le diffuse dans
    // l'instruction même de son contrôle.
    createdAt: receivedAt,
    // Un état, pas un moment : vrai tant que la table embarquée n'a pas bougé.
    standing: true,
    occurrences: [], tools: [],
    message: WORDING[d.kind](d.model),
    acknowledged: false,
  };
}
