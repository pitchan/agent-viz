// Le curseur de lecture de la page dans le fichier d'événements de la session
// affichée : l'octet qui suit la dernière ligne traitée.

export interface EventCursor { offset: number }

export const START: EventCursor = { offset: 0 };

// Un événement reçu en direct, tel que le flux le diffuse.
export interface LiveEvent { offset: number }

export function afterLiveEvent(cursor: EventCursor, _live: LiveEvent): EventCursor {
  return cursor;
}

// Une réponse de GET /events : `body` couvre les octets de la fin du fichier,
// jusqu'à `size`. Rend les lignes à traiter et le curseur qui les suit.
export function catchUp(_cursor: EventCursor, body: Uint8Array, size: number): { lines: string[]; cursor: EventCursor } {
  const lines = new TextDecoder().decode(body).trim().split('\n');
  return { lines, cursor: { offset: size } };
}
