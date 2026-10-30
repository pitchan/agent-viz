// Le curseur de lecture de la page dans le fichier d'événements de la session
// affichée : l'octet qui suit la dernière ligne traitée, dans la mise en page
// `layout` du fichier — le serveur la change à chaque compaction.

export interface EventCursor { offset: number; layout: number }

export const START: EventCursor = { offset: 0, layout: 0 };

// Un événement reçu en direct porte la fin de sa ligne : le rattrapage du
// retour sur l'onglet repart de là, sans retraiter ce que le direct a montré.
export interface LiveEvent { offset: number; layout: number }

export function afterLiveEvent(_cursor: EventCursor, live: LiveEvent): EventCursor {
  return { offset: live.offset, layout: live.layout };
}

// Une réponse de GET /events : `body` couvre les derniers octets du fichier,
// jusqu'à `size`, dans la mise en page `layout`. Le direct a pu montrer une
// partie de ces lignes pendant que la réponse voyageait : elles sont écartées.
export function catchUp(cursor: EventCursor, body: Uint8Array, size: number, layout: number): { lines: string[]; cursor: EventCursor } {
  const sameLayout = layout === cursor.layout;
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let start = 0;
  while (start < body.length) {
    const nl = body.indexOf(0x0a, start);
    const end = nl === -1 ? body.length : nl + 1;
    if (!sameLayout || size - body.length + end > cursor.offset) lines.push(decoder.decode(body.subarray(start, end)).trim());
    start = end;
  }
  const offset = sameLayout ? Math.max(cursor.offset, size) : size;
  return { lines: lines.filter(Boolean), cursor: { offset, layout } };
}
