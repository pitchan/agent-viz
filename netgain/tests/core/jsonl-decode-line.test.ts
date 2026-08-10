import { describe, expect, test } from 'vitest';
import { decodeJsonlLine, iterJsonlLines, type JsonlLine } from '../../src/core/jsonl.js';

// C2 (docs/audit-qualite-code.md) : le decodage JSONL est reimplemente sur 7
// fichiers cote serveur, avec une tolerance au BOM incidente et inegale.
//
// Ce qui est commun aux sept n'est PAS la lecture — ils lisent de quatre
// manieres legitimement differentes (flux complet, contenu deja en memoire,
// sonde bornee a 4 Ko, tail incremental) — mais la decision prise sur UNE
// ligne : retirer le BOM, ignorer une ligne vide, analyser, et SIGNALER un
// echec au lieu de l'avaler. C'est cette decision qu'on extrait ici, pour
// qu'elle ait une seule definition.
//
// `iterJsonlLines` devient un simple mode de lecture par-dessus. Son
// comportement ne doit pas bouger d'un iota : son test d'origine
// (jsonl.test.ts) reste la preuve de non-regression, et le dernier test de ce
// fichier verifie explicitement que les deux passent par le meme chemin.

describe('decodeJsonlLine', () => {
  test('une ligne valide rend sa valeur', () => {
    expect(decodeJsonlLine('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  test('une ligne cassee est SIGNALEE, jamais levee ni avalee', () => {
    expect(decodeJsonlLine('{"tronqué":')).toEqual({ ok: false, rawLength: 11 });
  });

  test('une ligne vide ou blanche rend null — rien a emettre, ce n’est pas une erreur', () => {
    expect(decodeJsonlLine('')).toBeNull();
    expect(decodeJsonlLine('   ')).toBeNull();
    expect(decodeJsonlLine('\t \r')).toBeNull();
  });

  test('les espaces autour d’une ligne valide ne genent pas', () => {
    expect(decodeJsonlLine('  {"a":1}  ')).toEqual({ ok: true, value: { a: 1 } });
    expect(decodeJsonlLine('{"a":1}\r')).toEqual({ ok: true, value: { a: 1 } });
  });

  // Ce test a d'abord ete ecrit FAUX : il attendait qu'un BOM hors premiere
  // ligne soit signale en erreur. Il ne peut pas l'etre — trim() retire deja
  // U+FEFF, qui appartient a la production WhiteSpace d'ECMAScript. C'est le
  // test rouge qui a revele que le retrait conditionnel « seulement sur la
  // premiere ligne » de la version precedente etait du CODE MORT.
  test('un BOM est tolere sur N’IMPORTE QUELLE ligne, et c’est trim() qui le fait', () => {
    const BOM = String.fromCharCode(0xfeff);
    expect(decodeJsonlLine(BOM + '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(decodeJsonlLine(BOM + '   {"a":1}  ')).toEqual({ ok: true, value: { a: 1 } });
    // Le mecanisme, epingle pour qu'on ne « restaure » jamais un retrait
    // explicite en croyant corriger un oubli.
    expect((BOM + '{"a":1}').trim()).toBe('{"a":1}');
    expect(() => JSON.parse(BOM + '{"a":1}')).toThrow();
  });

  test('rawLength compte la ligne APRES nettoyage, pas la ligne brute', () => {
    const r = decodeJsonlLine('   {cassé}   ') as Extract<JsonlLine, { ok: false }>;
    expect(r.ok).toBe(false);
    expect(r.rawLength).toBe('{cassé}'.length);
  });

  test('une valeur JSON scalaire est valide — le decodeur ne juge pas la forme', () => {
    expect(decodeJsonlLine('42')).toEqual({ ok: true, value: 42 });
    expect(decodeJsonlLine('null')).toEqual({ ok: true, value: null });
  });
});

describe('iterJsonlLines passe bien par decodeJsonlLine', () => {
  test('les deux rendent le meme verdict sur les memes lignes', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = (await import('node:path')).default;

    const dir = mkdtempSync(path.join(tmpdir(), 'netgain-decode-'));
    try {
      const lignes = ['{"a":1}', '{"cassé":', '', '  {"b":2}  '];
      const p = path.join(dir, 'melange.jsonl');
      writeFileSync(p, lignes.join('\n') + '\n');

      const parLecture: JsonlLine[] = [];
      for await (const l of iterJsonlLines(p)) parLecture.push(l);

      const parDecodage = lignes
        .map(l => decodeJsonlLine(l))
        .filter((r): r is JsonlLine => r !== null);

      expect(parLecture).toEqual(parDecodage);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
