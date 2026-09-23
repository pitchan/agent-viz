// viz-pricing-adopted-alert.ts — l'alerte qu'un tarif Anthropic appliqué lève dans l'onglet.
//
// Module pur : le tarif arrive par le flux SSE (message `pricingAdopted`, diffusé par
// l'observatoire après chaque application), l'horloge arrive en paramètre. C'est un
// état hors session : `sessionId` vide dit « personne à nommer ».

// Clauses entières en `import type` : le serveur les efface au service, et le
// navigateur ne demande jamais src/server/price-adoption.ts.
import type { Adopted } from '../server/price-adoption.ts';
import type { LiveAlert } from './viz-watchdog-client.ts';
import { modelLabel, ratesPerMTok } from './observatory/format.ts';

export type PricingAdoptedPayload = Pick<Adopted, 'model' | 'kind' | 'prices'>;

// Une phrase par nature de tarif appliqué. Un `kind` ajouté côté serveur sans sa
// phrase ici ne compile pas.
const WORDING: Record<Adopted['kind'], (label: string) => string> = {
  'modele-nouveau': l => `Tarif Anthropic appliqué : nouveau modèle ${l}`,
  'tarif-different': l => `Tarif Anthropic mis à jour : ${l}`,
};

// L'id est stable par modèle : la déduplication du registre externe (même id
// actif, pas de nouvelle sonnerie) repose dessus. Les chaînes vides sont celles
// que le détecteur pose pour « rien » : aucun agent, commande, projet ni motif.
export function pricingAdoptedAlert(p: PricingAdoptedPayload, receivedAt: number): LiveAlert {
  return {
    id: `pricingAdopted:${p.model}`,
    type: 'pricingAdopted',
    sessionId: '', agentId: '', agentType: '', cwd: '',
    toolName: p.model,
    subject: `$ par million : ${ratesPerMTok(p.prices)}`,
    patternId: '',
    count: 1,
    // L'instant où l'onglet a reçu le message.
    createdAt: receivedAt,
    // Un état, pas un moment : il reste affiché jusqu'à l'acquittement.
    standing: true,
    occurrences: [], tools: [],
    message: WORDING[p.kind](modelLabel(p.model)),
    acknowledged: false,
  };
}
