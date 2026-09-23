'use strict';
// Lecture des deux pages officielles d'Anthropic que la vigie des tarifs consulte,
// dans leur version Markdown. Module pur : le texte arrive en paramètre, le réseau
// vit dans pricing.ts. Une page dont la forme a changé est une erreur nommée : un
// tableau illisible ne doit jamais se lire comme « aucun écart ».

import { normalizeModel } from '../engine/core/pricing.ts';
import type { ModelPrices } from '../engine/core/pricing.ts';

const cellsOf = (line: string): string[] => line.split('|').slice(1, -1).map(c => c.trim());

// « Claude Opus 5.5 ([limited availability](…)) » → claude-opus-5-5. Une ligne qui
// n'a pas cette forme n'est pas un modèle que la vigie sait nommer : elle est ignorée.
function idOfName(cell: string): string | null {
  const name = cell.replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '').trim();
  const m = /^Claude ([A-Z][a-z]+) (\d+)(?:\.(\d+))?$/.exec(name);
  if (!m) return null;
  return `claude-${m[1]!.toLowerCase()}-${m[2]}${m[3] === undefined ? '' : `-${m[3]}`}`;
}

// « $0.20 / MTok<sup>2</sup> » → 2e-7 dollar par jeton ; toPrecision ôte le bruit
// flottant de la division (0.2 / 1e6).
function perToken(cell: string): number | null {
  const m = /^\$([\d.]+) \/ MTok/.exec(cell);
  return m ? Number((Number(m[1]) / 1e6).toPrecision(12)) : null;
}

/** Les quatre tarifs par modèle, lus dans le premier tableau de « ## Model pricing ». */
export function parsePricingPage(markdown: string): Map<string, ModelPrices> {
  const lines = markdown.split(/\r?\n/);
  const section = lines.findIndex(l => l.trim() === '## Model pricing');
  const header = section < 0 ? -1 : lines.findIndex((l, i) => i > section && l.startsWith('| Model'));
  if (header < 0) throw new Error('page des tarifs : tableau des tarifs introuvable sous « ## Model pricing »');
  const cols = cellsOf(lines[header]!);
  const col = (label: string): number => {
    const i = cols.findIndex(c => c.startsWith(label));
    if (i < 0) throw new Error(`page des tarifs : colonne « ${label} » introuvable dans le tableau des tarifs`);
    return i;
  };
  const at = { input: col('Base input'), w5m: col('5m cache writes'), w1h: col('1h cache writes'), read: col('Cache hits'), output: col('Output') };

  const prices = new Map<string, ModelPrices>();
  // La ligne après l'en-tête est le séparateur ; le tableau finit à la première ligne sans « | ».
  for (let i = header + 2; i < lines.length && lines[i]!.startsWith('|'); i++) {
    const cells = cellsOf(lines[i]!);
    const id = idOfName(cells[0] ?? '');
    const input = perToken(cells[at.input] ?? '');
    const cacheCreate = perToken(cells[at.w5m] ?? '');
    const w1h = perToken(cells[at.w1h] ?? '');
    const cacheRead = perToken(cells[at.read] ?? '');
    const output = perToken(cells[at.output] ?? '');
    if (id === null || input === null || cacheCreate === null || w1h === null || cacheRead === null || output === null) continue;
    // La formule de coût chiffre l'écriture 1 h à 2 × l'entrée : un modèle qui s'en écarte
    // serait mal chiffré, il n'entre pas.
    if (Math.abs(w1h - 2 * input) > input * 1e-9) continue;
    prices.set(id, { input, output, cacheCreate, cacheRead });
  }
  if (prices.size === 0) throw new Error('page des tarifs : aucune ligne de modèle lisible dans le tableau des tarifs');
  return prices;
}

// « 1M tokens » → 1 000 000 ; « 200K tokens » → 200 000.
function windowOf(cell: string): number | null {
  const m = /^([\d.]+)([KM]) tokens$/.exec(cell);
  return m ? Number(m[1]) * (m[2] === 'M' ? 1_000_000 : 1_000) : null;
}

/** Fenêtre de contexte par identifiant canonique, lue dans le tableau « Compare models ». */
export function parseModelsPage(markdown: string): Map<string, number> {
  const lines = markdown.split(/\r?\n/);
  const idLine = lines.find(l => l.startsWith('| Claude API ID'));
  const windowLine = lines.find(l => /^\| \[?Context window/.test(l));
  if (!idLine || !windowLine) throw new Error('page des modèles : lignes « Claude API ID » et fenêtre de contexte introuvables');
  const ids = cellsOf(idLine).slice(1);
  const windows = cellsOf(windowLine).slice(1);
  const out = new Map<string, number>();
  ids.forEach((cell, i) => {
    const id = normalizeModel(cell.replace(/`/g, ''));
    const w = windowOf(windows[i] ?? '');
    if (id !== null && w !== null) out.set(id, w);
  });
  return out;
}
