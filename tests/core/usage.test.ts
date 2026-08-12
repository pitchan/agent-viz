import { describe, expect, test } from 'vitest';
import { addUsage, emptyUsageBucket, isDedupableMsgId, sumUsageInto } from '../../src/engine/core/usage.js';

// C3 (docs/audit-qualite-code.md) : l'accumulation des jetons d'usage etait
// reimplementee cote serveur (lib/server/tokens.js, `accumulateUsage`) et cote
// moteur (netgain/src/doctor/aggregators/tokens.ts, `addUsage`).
//
// LA FICHE SE TROMPAIT SUR UN POINT, et la sonde differentielle l'a montre en
// EXECUTANT les deux fonctions reelles sur la meme matrice : elle affirmait
// « les memes gardes a zero » et « pas de divergence de comportement sur ce
// perimetre commun ». Il y en avait deux — la meme famille qu'en C5, une
// question de garde :
//
//   input_tokens: NaN      -> serveur 0 (`|| 0`)  · moteur NaN (`?? 0`)
//   meme id "" deux fois   -> serveur accumule 2x · moteur deduplique
//
// AUCUNE DES DEUX N'ETAIT ATTEIGNABLE, verifie aussi : `JSON.parse` REFUSE le
// litteral NaN, et `"id":""` apparait 0 fois sur les 833 transcripts de la
// machine. Ce sont des pieges latents — gratuits a supprimer en unifiant, pas
// des defauts vivants. Ne pas les raconter comme des pannes.

describe('addUsage — un seul jeu de gardes', () => {
  test('accumule les six champs', () => {
    const b = emptyUsageBucket();
    addUsage(b, {
      input_tokens: 10, output_tokens: 5,
      cache_creation_input_tokens: 100, cache_read_input_tokens: 7,
      cache_creation: { ephemeral_1h_input_tokens: 60, ephemeral_5m_input_tokens: 40 },
    });
    expect(b).toEqual({ in: 10, out: 5, cacheCreate: 100, cacheRead: 7, cacheCreate1h: 60, cacheCreate5m: 40 });
  });

  test('cumule d\'un message a l\'autre', () => {
    const b = emptyUsageBucket();
    addUsage(b, { input_tokens: 10 });
    addUsage(b, { input_tokens: 5 });
    expect(b.in).toBe(15);
  });

  test('un champ absent ou nul vaut zero', () => {
    const b = emptyUsageBucket();
    addUsage(b, {});
    addUsage(b, { input_tokens: undefined, output_tokens: undefined });
    expect(b).toEqual(emptyUsageBucket());
  });

  // LA GARDE RETENUE : un champ qui n'est pas un nombre FINI vaut zero. Ni le
  // `|| 0` du serveur ni le `?? 0` du moteur ne couvraient tout, et il fallait
  // en choisir une seule — c'est ce que la cible de la fiche demande.
  test('NaN vaut zero, il n\'empoisonne pas le seau', () => {
    const b = emptyUsageBucket();
    addUsage(b, { input_tokens: NaN, output_tokens: 5 });
    addUsage(b, { input_tokens: 10 });
    expect(b.in).toBe(10);
    expect(Number.isNaN(b.in)).toBe(false);
  });

  // Le SEUL des poisons qui soit atteignable depuis du JSON valide : `1e999`
  // s'analyse en Infinity (verifie en executant, la ou le litteral `NaN` est
  // refuse). Les deux implementations d'avant le laissaient passer.
  test('Infinity vaut zero — c\'est le poison qu\'un JSON valide peut porter', () => {
    const b = emptyUsageBucket();
    expect(JSON.parse('{"input_tokens":1e999}').input_tokens).toBe(Infinity);
    addUsage(b, JSON.parse('{"input_tokens":1e999,"output_tokens":5}'));
    expect(b.in).toBe(0);
    expect(b.out).toBe(5);
  });

  // CHANGEMENT DE COMPORTEMENT ASSUME ET DATE (2026-08-11). Avant, les DEUX
  // cotes rendaient la chaine "0100" — verifie en executant : `0 + "100"`
  // concatene, et le seau partait en chaine pour toute la suite de la session,
  // jusque dans l'enveloppe SSE. Un nombre en chaine est une ligne malformee ;
  // la compter zero est une perte, la laisser casser l'arithmetique en est une
  // autre, plus large. Aucun transcript reel n'en porte.
  test('un nombre en chaine vaut zero, il ne transforme pas le seau en texte', () => {
    const b = emptyUsageBucket();
    addUsage(b, { input_tokens: '100' as unknown as number, output_tokens: 5 });
    expect(b.in).toBe(0);
    expect(typeof b.in).toBe('number');
  });

  test('un nombre negatif est accumule tel quel — ce n\'est pas a la primitive d\'en juger', () => {
    const b = emptyUsageBucket();
    addUsage(b, { input_tokens: -10 });
    expect(b.in).toBe(-10);
  });

  test('la ventilation de cache est independante du total de creation', () => {
    // Le moteur suit les deux fenetres SANS que leur somme doive valoir
    // cache_creation_input_tokens : ce sont deux champs bruts distincts, et la
    // primitive ne reconcilie rien.
    const b = emptyUsageBucket();
    addUsage(b, { cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 10 } });
    expect(b.cacheCreate).toBe(100);
    expect(b.cacheCreate1h).toBe(10);
    expect(b.cacheCreate5m).toBe(0);
  });
});

describe('sumUsageInto — fusionner deux seaux', () => {
  test('additionne les six champs, et ne touche pas la source', () => {
    const cible = emptyUsageBucket();
    const src = emptyUsageBucket();
    addUsage(src, {
      input_tokens: 1, output_tokens: 2,
      cache_creation_input_tokens: 3, cache_read_input_tokens: 4,
      cache_creation: { ephemeral_1h_input_tokens: 5, ephemeral_5m_input_tokens: 6 },
    });
    sumUsageInto(cible, src);
    sumUsageInto(cible, src);
    expect(cible).toEqual({ in: 2, out: 4, cacheCreate: 6, cacheRead: 8, cacheCreate1h: 10, cacheCreate5m: 12 });
    expect(src.in).toBe(1);
  });
});

describe('isDedupableMsgId — la regle de deduplication, une seule fois', () => {
  test('un identifiant reel deduplique', () => {
    expect(isDedupableMsgId('msg_01')).toBe(true);
  });

  test('absent ou null : rien a dedupliquer, on accumule', () => {
    expect(isDedupableMsgId(null)).toBe(false);
    expect(isDedupableMsgId(undefined)).toBe(false);
  });

  // L'ARBITRAGE, et c'est le seul point ou les deux cotes se contredisaient
  // vraiment : le serveur testait la verite (`if (msgId)`), le moteur la
  // non-nullite (`if (msgId !== null)`). C'est le SENS DU SERVEUR qui est
  // retenu — un identifiant vide n'est pas un identifiant.
  //
  // Ce n'est pas un choix de style : dedupliquer sur "" fusionnerait des
  // messages DISTINCTS qui n'ont pas d'identifiant en un seul, donc
  // SOUS-COMPTERAIT. Meme doctrine que la variable d'environnement vide de C5.
  test('une chaine VIDE n\'est pas un identifiant — sinon on sous-compte', () => {
    expect(isDedupableMsgId('')).toBe(false);
  });

  test('ce qui n\'est pas une chaine n\'est pas un identifiant', () => {
    expect(isDedupableMsgId(42)).toBe(false);
    expect(isDedupableMsgId({})).toBe(false);
  });
});
