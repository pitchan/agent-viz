// Une seule regle decide ce qui est additionne (countOrZero) et ce qui est juge
// malforme (usageVerdict) : un compte de jetons est un entier >= 0. Ces deux tables
// SONT cette regle, et les deux filets qui l'eprouvent les lisent ici.
export const COMPTES: Array<[string, number]> = [
  ['100', 100],
  ['0', 0],
];

export const PAS_DES_COMPTES: Array<[string, unknown]> = [
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
