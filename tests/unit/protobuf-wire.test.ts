import { expect, test } from 'vitest';
import { readFields } from '../../src/server/transcript-adapters/protobuf-wire.ts';
import { pbBytes, pbMessage, pbVarint } from '../helpers/protobuf-encode.ts';

test('un message rend ses champs dans l\'ordre, entiers et blocs', () => {
  // Arrange
  const bloc = pbMessage(pbVarint(2, 12087), pbBytes(19, 'gemini-3.8-flash'), pbVarint(3, 749));
  // Act
  const champs = readFields(bloc);
  // Assert
  expect(champs?.map(c => [c.no, c.varint ?? new TextDecoder().decode(c.bytes)])).toEqual([
    [2, 12087], [19, 'gemini-3.8-flash'], [3, 749],
  ]);
});

test('un bloc vide est un message sans champ', () => {
  // Arrange
  const bloc = new Uint8Array(0);
  // Act
  const champs = readFields(bloc);
  // Assert
  expect(champs).toEqual([]);
});

test('une longueur qui dépasse la fin du bloc rend null', () => {
  // Arrange — le champ 1 annonce 5 octets, il n'en reste que 2
  const bloc = Uint8Array.from([0x0a, 0x05, 0x41, 0x42]);
  // Act
  const champs = readFields(bloc);
  // Assert
  expect(champs).toBeNull();
});

test('un entier coupé en plein milieu rend null', () => {
  // Arrange — l'octet de suite (bit haut posé) n'a pas de successeur
  const bloc = Uint8Array.from([0x10, 0x80]);
  // Act
  const champs = readFields(bloc);
  // Assert
  expect(champs).toBeNull();
});

test('un type de champ que le lecteur ne connaît pas rend null', () => {
  // Arrange — type 3 (début de groupe) sur le champ 1
  const bloc = Uint8Array.from([0x0b]);
  // Act
  const champs = readFields(bloc);
  // Assert
  expect(champs).toBeNull();
});

test('un entier au-delà de 2^53 est gardé comme champ sans valeur', () => {
  // Arrange — 2^64 - 1, la valeur qu'Antigravity pose sur un de ses champs
  const bloc = Uint8Array.from([0x10, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
  // Act
  const champs = readFields(bloc);
  // Assert
  expect(champs).toEqual([{ no: 2 }]);
});

test('les champs à taille fixe sont sautés sans décaler la suite', () => {
  // Arrange — champ 1 sur 8 octets, champ 2 sur 4 octets, puis un entier
  const bloc = Uint8Array.from([0x09, 1, 2, 3, 4, 5, 6, 7, 8, 0x15, 1, 2, 3, 4, ...pbVarint(3, 7)]);
  // Act
  const champs = readFields(bloc);
  // Assert
  expect(champs).toEqual([{ no: 1 }, { no: 2 }, { no: 3, varint: 7 }]);
});
