import { describe, expect, test } from 'vitest';
import { isNetgainRouterHook } from '../../src/install/hook-edit.js';
import { estAvantFusion, porteQueueAvantFusion, QUEUE_HOOK, QUEUE_MCP } from '../../src/install/rupture.js';

// Une entrée écrite depuis une AUTRE racine et SANS guillemets : la forme exacte que
// hook-edit.test.ts:29 prouve déjà reconnue comme nôtre, et le 5ᵉ faux négatif que la
// comparaison à la commande reconstruite ne sait pas voir.
const AUTRE_RACINE_SANS_QUOTES = 'node C:/vieux/netgain/dist/cli.js router-hook';
// La même entrée avec la casse tapée et les antislashes que Windows restitue.
const AUTRE_RACINE_CASSE_ANTISLASH = 'node "C:\\Vieux\\NetGain\\dist\\cli.js" router-hook';
// Un crochet étranger : il ne porte la queue d'avant la fusion nulle part.
const CROCHET_ETRANGER = 'node C:/autre-outil/dist/cli.js router-hook';

// La commande SOUHAITÉE aujourd'hui porte encore la queue (racine <dépôt>/netgain) ;
// après la tâche 3 elle ne la porte plus (racine <dépôt>, sortie dist/engine/).
const SOUHAITE_AVANT_FUSION = 'node "F:/DEV/agent-viz/netgain/dist/cli.js" router-hook';
const SOUHAITE_APRES_FUSION = 'node "F:/DEV/agent-viz/dist/engine/cli.js" router-hook';

describe('estAvantFusion', () => {
  test('T1 — entrée d avant la fusion, autre racine et sans guillemets : signalée quand le souhaité ne porte plus la queue', () => {
    // Arrange
    const enregistre = AUTRE_RACINE_SANS_QUOTES;

    // Act
    const signale = estAvantFusion(enregistre, SOUHAITE_APRES_FUSION, QUEUE_HOOK);

    // Assert
    expect(signale).toBe(true);
  });

  test('T2 — le MÊME enregistrement n est PAS signalé tant que le souhaité porte encore la queue (aujourd hui)', () => {
    // Arrange
    const enregistre = AUTRE_RACINE_SANS_QUOTES;

    // Act
    const signale = estAvantFusion(enregistre, SOUHAITE_AVANT_FUSION, QUEUE_HOOK);

    // Assert
    expect(signale).toBe(false);
  });

  test('T3 — une entrée étrangère, sans la queue, n est jamais signalée', () => {
    // Arrange
    const enregistre = CROCHET_ETRANGER;

    // Act
    const signale = estAvantFusion(enregistre, SOUHAITE_APRES_FUSION, QUEUE_HOOK);

    // Assert
    expect(signale).toBe(false);
  });

  test('T4 — casse et antislashes ne changent pas le verdict', () => {
    // Arrange
    const enregistre = AUTRE_RACINE_CASSE_ANTISLASH;

    // Act
    const signale = estAvantFusion(enregistre, SOUHAITE_APRES_FUSION, QUEUE_HOOK);

    // Assert
    expect(signale).toBe(true);
  });
});

describe('isNetgainRouterHook', () => {
  test('T7 — une commande dist/engine/cli.js finissant par router-hook, depuis une racine SANS le mot netgain, est nôtre', () => {
    // Arrange
    const commande = 'node "C:/depots/agent-viz/dist/engine/cli.js" router-hook';

    // Act
    const notre = isNetgainRouterHook(commande);

    // Assert
    expect(notre).toBe(true);
  });
});

describe('porteQueueAvantFusion', () => {
  test('T8 — une valeur non-chaîne rend false SANS lever (côté MCP, args[0] n est garanti par rien)', () => {
    // Arrange
    const difformes: unknown[] = [undefined, null, 42, { chemin: AUTRE_RACINE_SANS_QUOTES }];

    // Act
    const verdicts = difformes.map((v) => porteQueueAvantFusion(v, QUEUE_MCP));

    // Assert
    expect(verdicts).toEqual([false, false, false, false]);
  });
});
