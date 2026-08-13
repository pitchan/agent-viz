'use strict';
// The provenance notice of the « Jetons & tarifs » panel, served as
// structured data by GET /pricing. It lives server-side, next to the code it
// describes, and quotes REAL values (SCAN_VERSION, engine version, price
// source) so it cannot silently drift from what the program does. French
// copy: the reader is the product's user, not a developer.

import { SCAN_VERSION } from './scan-version.ts';

function buildProvenance({ engineVersion, priceSource }) {
  return {
    scanVersion: SCAN_VERSION,
    engineVersion,
    priceSource,
    sections: [
      {
        titre: 'Origine des nombres bruts',
        corps: 'Les nombres viennent des fichiers de transcription JSONL que Claude Code écrit '
          + 'localement (projects/<projet>/<session>.jsonl, sous-agents dans subagents/). Chaque '
          + 'message y porte un champ usage : jetons d’entrée (input_tokens), de sortie '
          + '(output_tokens), d’écriture de cache (cache_creation_input_tokens), de relecture de '
          + 'cache (cache_read_input_tokens), et le détail cache 5 minutes / 1 heure quand l’API '
          + 'le fournit. Lecture seule, en flux, jamais d’appel réseau.',
      },
      {
        titre: 'Déduplication obligatoire',
        corps: 'Claude Code écrit une ligne JSONL par bloc de contenu, toutes portant le MÊME '
          + 'usage. Sans déduplication par message.id (agent par agent), les jetons seraient '
          + 'comptés plusieurs fois. Le moteur ne compte chaque message qu’une seule fois.',
      },
      {
        titre: 'Jetons nets',
        corps: 'Jetons nets = entrée + écriture de cache + sortie. La relecture de cache est exclue '
          + 'et affichée séparément — les deux grandeurs ne s’additionnent jamais (règle '
          + 'd’homogénéité : des natures différentes ne se mélangent pas).',
      },
      {
        titre: 'Formule de coût',
        corps: 'Pour chaque message : entrée × tarif d’entrée + sortie × tarif de sortie + cache '
          + '5 minutes × tarif d’écriture + cache 1 heure × (tarif d’entrée × 2) + relecture × '
          + 'tarif de relecture. Quand le transcript ne détaille pas les tiers de cache, tout le '
          + 'total d’écriture passe au tarif 5 minutes.',
      },
      {
        titre: 'Barème appliqué',
        corps: 'Table de tarifs embarquée localement, jamais récupérée par le réseau. Le tarif '
          + 'appliqué à chaque message est celui en vigueur à la date du message : les périodes '
          + 'datées sont conservées (exemple : Sonnet 5 au tarif de lancement jusqu’au 31/08/2026, '
          + 'au catalogue ensuite).',
      },
      {
        titre: 'Zéro voulu et tarif inconnu',
        corps: 'Les modèles non facturables par nature — <synthetic> (artefact du harnais Claude '
          + 'Code, aucun appel API) et les modèles locaux — sont tarifés 0 $ délibérément, avec '
          + 'leur raison affichée. Un modèle au tarif inconnu rend « inconnu », jamais un zéro '
          + 'silencieux, et marque le total « partiel ».',
      },
      {
        titre: 'Une seule table pour tout le produit',
        corps: 'La pastille temps réel de la barre du haut est tarifée par la MÊME table embarquée '
          + 'que ce panneau (unification du 05/08/2026). Une vigie compare chaque jour cette table '
          + 'au dépôt public LiteLLM : toute dérive (tarif changé en amont, nouveau modèle) '
          + 'déclenche une alerte visible au lieu d’un écart silencieux. Réseau injoignable = '
          + 'silence normal, jamais une erreur.',
      },
      {
        titre: 'Limites honnêtes',
        corps: 'La tarification par paliers au-delà de 200 000 jetons d’entrée n’est pas modélisée. '
          + 'La ventilation par modèle ne distingue pas l’agent principal des sous-agents. Les '
          + 'sessions illisibles sont comptées à part, jamais fondues dans les totaux. Les '
          + 'sessions machine sont exclues par défaut.',
      },
    ],
  };
}

export { buildProvenance };