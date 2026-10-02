import { expect, test } from 'vitest';
import { decodeGenMetadata } from '../../src/server/transcript-adapters/antigravity-usage.ts';
import { pbBytes, pbMessage, pbVarint } from '../helpers/protobuf-encode.ts';

// Les nombres sont ceux relevés sur des sessions réelles (agy 1.2.13).
function bloc(usage: Uint8Array[], modele: string | null = 'gemini-3.8-flash'): Uint8Array {
  const appel = [pbVarint(3, 1318), pbBytes(4, pbMessage(...usage))];
  if (modele !== null) appel.push(pbBytes(19, modele));
  return pbMessage(pbBytes(1, pbMessage(...appel)), pbBytes(2, 'xx'));
}

const SANS_CACHE = [
  pbVarint(1, 1318), pbVarint(2, 12087), pbVarint(3, 749), pbVarint(6, 24),
  pbBytes(7, 'bot-e57b78ee'), pbVarint(9, 657), pbVarint(10, 92), pbBytes(11, '2sW_apGjAe6C'),
];

test('un appel sans lecture en cache rend entrée, sortie, modèle et identifiant', () => {
  // Arrange
  const b = bloc(SANS_CACHE);
  // Act
  const lu = decodeGenMetadata(b);
  // Assert
  expect(lu).toEqual({
    ok: true,
    id: 'bot-e57b78ee',
    model: 'gemini-3.8-flash',
    usage: { input_tokens: 12087, output_tokens: 749, cache_read_input_tokens: 0 },
  });
});

test('la lecture en cache est comptée à part de l\'entrée', () => {
  // Arrange — appel où l'entrée chute parce qu'une part vient du cache
  const b = bloc([
    pbVarint(1, 1318), pbVarint(2, 3044), pbVarint(3, 2571), pbVarint(5, 16264), pbVarint(6, 24),
    pbBytes(7, 'bot-6114fefd'), pbVarint(9, 2443), pbVarint(10, 128),
  ]);
  // Act
  const lu = decodeGenMetadata(b);
  // Assert
  expect(lu).toMatchObject({
    ok: true,
    usage: { input_tokens: 3044, output_tokens: 2571, cache_read_input_tokens: 16264 },
  });
});

test('une sortie qui ne vaut plus réflexion + réponse est refusée', () => {
  // Arrange — 749 annoncé, 657 + 91 trouvés
  const b = bloc([pbVarint(2, 12087), pbVarint(3, 749), pbBytes(7, 'bot-x'), pbVarint(9, 657), pbVarint(10, 91)]);
  // Act
  const lu = decodeGenMetadata(b);
  // Assert
  expect(lu).toEqual({ ok: false, reason: 'sortie 749 ≠ réflexion 657 + réponse 91' });
});

test('un champ jamais mesuré sous le bloc des jetons est refusé', () => {
  // Arrange
  const b = bloc([...SANS_CACHE, pbVarint(12, 5)]);
  // Act
  const lu = decodeGenMetadata(b);
  // Assert
  expect(lu).toEqual({ ok: false, reason: 'champ inconnu .1.4.12' });
});

test('un compteur présent deux fois est refusé', () => {
  // Arrange
  const b = bloc([...SANS_CACHE, pbVarint(2, 1)]);
  // Act
  const lu = decodeGenMetadata(b);
  // Assert
  expect(lu).toEqual({ ok: false, reason: 'champ répété sous .1.4' });
});

test('un appel sans aucun jeton en entrée est refusé', () => {
  // Arrange
  const b = bloc([pbVarint(3, 10), pbBytes(7, 'bot-x'), pbVarint(10, 10)]);
  // Act
  const lu = decodeGenMetadata(b);
  // Assert
  expect(lu).toEqual({ ok: false, reason: 'entrée nulle' });
});

test('un appel sans nom de modèle est refusé', () => {
  // Arrange
  const b = bloc(SANS_CACHE, null);
  // Act
  const lu = decodeGenMetadata(b);
  // Assert
  expect(lu).toEqual({ ok: false, reason: 'modèle absent' });
});

test('un appel sans identifiant est refusé', () => {
  // Arrange
  const b = bloc([pbVarint(2, 12087), pbVarint(3, 749), pbVarint(9, 657), pbVarint(10, 92)]);
  // Act
  const lu = decodeGenMetadata(b);
  // Assert
  expect(lu).toEqual({ ok: false, reason: "identifiant d'appel absent" });
});

test('des octets qui ne sont pas du protobuf sont refusés', () => {
  // Arrange
  const b = Uint8Array.from([0x0b, 0xff, 0xff]);
  // Act
  const lu = decodeGenMetadata(b);
  // Assert
  expect(lu).toEqual({ ok: false, reason: 'bloc illisible' });
});
