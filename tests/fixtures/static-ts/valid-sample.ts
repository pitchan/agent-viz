// Fixture : assez de types pour que le retrait change le texte, jamais les lignes.
export interface Point {
  x: number;
  y: number;
}

export function distance(a: Point, b: Point): number {
  const dx: number = a.x - b.x;
  const dy: number = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export const origin: Point = { x: 0, y: 0 };
