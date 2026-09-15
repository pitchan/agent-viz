import { describe, expect, test } from 'vitest';
import {
  addUsage, countOrZero, emptyUsageBucket, isDedupableMsgId, isTokenCount, sumUsageInto, usageVerdict,
} from '../../src/engine/core/usage.ts';

// C3 (docs/audit-qualite-code.md) : l'accumulation des jetons d'usage etait
// reimplementee cote serveur (src/server/tokens.js, `accumulateUsage`) et cote
// moteur (src/engine/doctor/aggregators/tokens.ts, `addUsage`).
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

  // LA GARDE RETENUE : un champ qui n'est pas un compte (entier >= 0) vaut zero. Ni le
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

  // CHANGEMENT DE COMPORTEMENT VOULU. Avant, les DEUX
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

  // Additionner un negatif retrancherait des jetons comptes sur d'autres
  // messages : le total ne serait plus une borne inferieure.
  test('un nombre negatif n\'est pas un compte : il vaut zero', () => {
    // Arrange
    const b = emptyUsageBucket();

    // Act
    addUsage(b, { input_tokens: -10, output_tokens: 5 });

    // Assert
    expect(b.in).toBe(0);
    expect(b.out).toBe(5);
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

// Une seule regle decide ce qui est additionne (countOrZero) et ce qui est juge
// malforme (usageVerdict) : un compte de jetons est un entier >= 0.
const COMPTES: Array<[string, number]> = [
  ['100', 100],
  ['0', 0],
];
const PAS_DES_COMPTES: Array<[string, unknown]> = [
  ['un negatif', -10],
  ['un decimal', 1.5],
  ['un nombre en chaine', '100'],
  ['Infinity (1e999 lu par JSON.parse)', JSON.parse('1e999')],
  ['NaN', NaN],
  ['un booleen', true],
  ['un objet', {}],
  ['un tableau', []],
  ['2^53, hors des entiers surs', 2 ** 53],
];

describe('isTokenCount — un compte de jetons est un entier >= 0', () => {
  test.each(COMPTES)('%s est un compte', (_label, valeur) => {
    expect(isTokenCount(valeur)).toBe(true);
  });

  test.each(PAS_DES_COMPTES)('%s n\'est pas un compte', (_label, valeur) => {
    expect(isTokenCount(valeur)).toBe(false);
  });
});

describe('countOrZero — la valeur si c\'est un compte, sinon zero', () => {
  test.each(COMPTES)('%s vaut sa valeur', (_label, valeur) => {
    expect(countOrZero(valeur)).toBe(valeur);
  });

  test.each(PAS_DES_COMPTES)('%s vaut zero', (_label, valeur) => {
    expect(countOrZero(valeur)).toBe(0);
  });
});

// La forme que Claude Code ecrit : les deux comptes que le type `Usage` du SDK
// rend obligatoires, et les champs de cache qu'il declare facultatifs.
const USAGE_SAIN = {
  input_tokens: 100,
  output_tokens: 5,
  cache_creation_input_tokens: 40,
  cache_read_input_tokens: 2000,
  cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 10 },
};

function sansChamp(champ: string): Record<string, unknown> {
  const u: Record<string, unknown> = { ...USAGE_SAIN };
  delete u[champ];
  return u;
}

describe('usageVerdict — la forme de l\'objet usage', () => {
  test.each([['absent', undefined], ['null', null]])('usage %s : absent, il n\'y a pas de mesure', (_label, raw) => {
    expect(usageVerdict(raw)).toBe('absent');
  });

  test.each([['une chaine', 'x'], ['un tableau', []], ['un nombre', 42], ['un booleen', true]])(
    'usage qui est %s : malforme',
    (_label, raw) => {
      expect(usageVerdict(raw)).toBe('malforme');
    },
  );

  test('usage objet vide : malforme, les deux comptes obligatoires manquent', () => {
    expect(usageVerdict({})).toBe('malforme');
  });

  test.each([['une chaine', 'x'], ['un tableau', []]])('cache_creation qui est %s : malforme', (_label, detail) => {
    expect(usageVerdict({ ...USAGE_SAIN, cache_creation: detail })).toBe('malforme');
  });

  test('usage aux comptes entiers : sain', () => {
    expect(usageVerdict(USAGE_SAIN)).toBe('sain');
  });

  test('les cles en plus sont ignorees : l\'usage reel d\'un message <synthetic> est sain', () => {
    // Arrange — releve tel quel dans un transcript : des zeros, et des cles que le type ne connait pas.
    const synthetic = {
      input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }, service_tier: null,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
      inference_geo: null, iterations: null, speed: null,
    };

    // Act
    const verdict = usageVerdict(synthetic);

    // Assert
    expect(verdict).toBe('sain');
  });
});

describe('usageVerdict — un champ de compte present', () => {
  test.each(PAS_DES_COMPTES)('input_tokens qui est %s : malforme', (_label, valeur) => {
    expect(usageVerdict({ ...USAGE_SAIN, input_tokens: valeur })).toBe('malforme');
  });

  test.each([
    ['output_tokens', { ...USAGE_SAIN, output_tokens: -10 }],
    ['cache_creation_input_tokens', { ...USAGE_SAIN, cache_creation_input_tokens: -10 }],
    ['cache_read_input_tokens', { ...USAGE_SAIN, cache_read_input_tokens: -10 }],
    ['cache_creation.ephemeral_5m_input_tokens', { ...USAGE_SAIN, cache_creation: { ephemeral_5m_input_tokens: -10 } }],
    ['cache_creation.ephemeral_1h_input_tokens', { ...USAGE_SAIN, cache_creation: { ephemeral_1h_input_tokens: -10 } }],
  ])('%s negatif : malforme, chaque champ de compte est lu', (_champ, usage) => {
    expect(usageVerdict(usage)).toBe('malforme');
  });

  test('cache_creation.ephemeral_5m_input_tokens en chaine : malforme', () => {
    expect(usageVerdict({ ...USAGE_SAIN, cache_creation: { ephemeral_5m_input_tokens: '1' } })).toBe('malforme');
  });
});

describe('usageVerdict — un champ absent ou null', () => {
  test.each([
    ['input_tokens absent', sansChamp('input_tokens')],
    ['input_tokens null', { ...USAGE_SAIN, input_tokens: null }],
    ['output_tokens absent', sansChamp('output_tokens')],
    ['output_tokens null', { ...USAGE_SAIN, output_tokens: null }],
  ])('%s : malforme, le type du SDK rend ce compte obligatoire', (_label, usage) => {
    expect(usageVerdict(usage)).toBe('malforme');
  });

  test.each([
    ['cache_creation_input_tokens absent', sansChamp('cache_creation_input_tokens')],
    ['cache_creation_input_tokens null', { ...USAGE_SAIN, cache_creation_input_tokens: null }],
    ['cache_read_input_tokens absent', sansChamp('cache_read_input_tokens')],
    ['cache_read_input_tokens null', { ...USAGE_SAIN, cache_read_input_tokens: null }],
    ['cache_creation absent', sansChamp('cache_creation')],
    ['cache_creation null', { ...USAGE_SAIN, cache_creation: null }],
    ['cache_creation vide', { ...USAGE_SAIN, cache_creation: {} }],
    ['cache_creation.ephemeral_5m_input_tokens null', { ...USAGE_SAIN, cache_creation: { ephemeral_5m_input_tokens: null } }],
    ['cache_creation.ephemeral_1h_input_tokens null', { ...USAGE_SAIN, cache_creation: { ephemeral_1h_input_tokens: null } }],
  ])('%s : sain, un champ de cache facultatif vaut zero', (_label, usage) => {
    expect(usageVerdict(usage)).toBe('sain');
  });
});
