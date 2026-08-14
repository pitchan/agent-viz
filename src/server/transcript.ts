'use strict';
// Transcript reader — locates a session's transcript via the per-agent
// adapter, scans for the first user prompt (cached), and tails the main
// transcript plus every sub-agent transcript (<session>/subagents/agent-*.jsonl)
// for events that adapters convert into per-bucket token usage.

import fs from 'node:fs';
const fsp = fs.promises;
import path from 'node:path';

import { sessionIndex, idFromPath } from './session-index.ts';
import type { SessionRecord } from './session-index.ts';
import { decodeJsonlLine } from './jsonl.ts';
import { ensureTokens, scheduleTokensBroadcast, tokenSum } from './tokens.ts';
import { broadcastSessionsChanged } from './sse.ts';
import { getAdapter } from './transcript-adapters/index.ts';
// Type partagé du contrat de Liskov des adaptateurs (index.ts, hors lot mais
// même lot 8) : ce que `parseUsageLine`/`discoverPath` attendent réellement
// pour `rec`. Emprunté par nom plutôt que redéclaré localement.
import type { UsageRecord } from './transcript-adapters/claude.ts';
// Ruling R8 (doc/36 §4.1) : `import type` seul, pour typer localement ce que
// `rec.tokens.main` porte réellement — voir `TokenState` ci-dessous.
import type { UsageBucket } from '../engine/core/usage.ts';

// La tranche `rec.transcript` telle que CE fichier la construit et la lit
// (seul propriétaire, voir l'en-tête de session-index.ts). `watcher: null`
// tant qu'aucun `fs.watch` n'a pu être ouvert (fichier introuvable au moment
// de l'appel) — voir `watchTail`.
interface Tail {
  path: string;
  offset: number;
  leftover: string;
  watcher: fs.FSWatcher | null;
  _readInFlight: boolean;
  _readPending: boolean;
  _watchTimer: NodeJS.Timeout | null;
}

interface TranscriptSlice {
  main: Tail | null;
  subagents: Map<string, Tail>;
  _mainPending: boolean;
  _closed: boolean;
}

// Frontière avec `tokens.ts` (hors lot, scellé) : sa forme précise (`Bucket`,
// `TokenState`) reste privée à ce module, comme documenté dans son propre
// commentaire pour `transcript-adapters/claude.ts` — ce fichier-ci reprend le
// même geste, avec les deux champs supplémentaires que LUI seul pose sur
// `rec.tokens` (`unsupported`, `transcriptMissing`).
interface TokenState {
  main: UsageBucket;
  perAgent: Map<string, UsageBucket>;
  unsupported?: boolean;
  transcriptMissing?: boolean;
}

// `rec` tel que CE fichier le voit : le disque canonique de session-index.ts
// (scellé), plus les deux tranches nommées que transcript.ts pose lui-même
// sur le même enregistrement (voir l'en-tête de session-index.ts). Un cast
// est nécessaire au point d'entrée (`sessionIndex.get` ne connaît que
// `SessionRecord`) — jamais un `any`, une vue plus précise du même objet.
type SessionWithSlices = SessionRecord & {
  transcript?: TranscriptSlice;
  tokens?: TokenState;
};

// Bridge vers la signature publique de `tokens.ts` : sa forme privée
// (`TokensCarrier`) n'est pas exportée, `Parameters<...>` l'emprunte sans la
// nommer — même geste qu'en lot 8 dans event-reader.ts pour
// `clearTokensTimer`. `rec` porte réellement cette forme à l'exécution
// (`ensureTokens` l'y pose) ; le cast documente la frontière.
type TokensCarrierLike = Parameters<typeof scheduleTokensBroadcast>[1];

// Un objet exploitable par accès de champ — même garde locale que
// session-index.ts et les autres fichiers du serveur : `decodeJsonlLine` ne
// promet qu'un JSON valide, pas un objet.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Read the first complete line of a file, however large. Streams in chunks
// and stops at the first '\n' — bounded by the line's length, not the file
// size. `cap` guards against a file with no newline at all (a single hook
// event past this size is pathological; return what was read so the caller
// reports an unreadable line loudly rather than hanging — since C2 that report
// is an explicit console.error on the verdict, no longer a thrown JSON.parse).
function readFirstLine(filePath: string, cap: number = 8 * 1024 * 1024): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let acc = '';
    // `'data'` accepte `string | Buffer` (l'un ou l'autre selon l'encodage du
    // flux) : l'encodage `'utf8'` ci-dessus rend TOUJOURS une `string` à
    // l'exécution, le repli `Buffer` ne sert qu'à satisfaire la signature de
    // l'événement sans rétrécir le type du callback.
    stream.on('data', (chunk: string | Buffer) => {
      acc += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const nl = acc.indexOf('\n');
      if (nl !== -1) { stream.destroy(); resolve(acc.slice(0, nl)); }
      else if (acc.length > cap) { stream.destroy(); resolve(acc); }
    });
    stream.on('end', () => resolve(acc)); // single line, no trailing '\n'
    stream.on('error', reject);
  });
}

// Read the first event of a session file and ask the per-agent adapter where
// the transcript lives. Adapters know whether their source stamps
// `transcript_path` on the first event. The first line is read in full
// regardless of size — a long UserPromptSubmit event can push it well past
// any fixed buffer, and `transcript_path` sits at its end.
async function getTranscriptPath(sessionFile: string): Promise<string | null> {
  try {
    const firstLine = await readFirstLine(sessionFile);
    // C2 : le verdict sur la ligne vient de la primitive commune du moteur.
    // Elle ne lève pas — un échec se LIT, il ne s'attrape pas — et le `catch`
    // ci-dessous ne peut donc plus servir de filet au décodage. La trace qu'il
    // écrivait pour une première ligne illisible est reprise ici, explicitement :
    // la faire disparaître au passage aurait été exactement la perte silencieuse
    // que C1 a coûté. Effet voulu par ailleurs : une première ligne préfixée
    // d'un BOM est désormais décodée au lieu de coûter le transcript entier.
    const verdict = decodeJsonlLine(firstLine);
    if (verdict === null) {
      console.error(`[transcript] ${idFromPath(sessionFile).slice(0, 8)}: empty session file — cannot extract transcript_path`);
      return null;
    }
    if (!verdict.ok) {
      console.error(
        `[transcript] ${idFromPath(sessionFile).slice(0, 8)}: unreadable first line ` +
        `(${verdict.rawLength} chars) — cannot extract transcript_path`,
      );
      return null;
    }
    const evt = verdict.value;
    const adapter = getAdapter(isRecord(evt) ? evt._source : undefined);
    return adapter.discoverPath(evt);
  } catch (err: unknown) {
    // Ne couvre plus que la lecture disque et l'adaptateur : le décodage, lui,
    // ne lève pas.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[transcript] ${idFromPath(sessionFile).slice(0, 8)}: getTranscriptPath failed — ${message}`);
    return null;
  }
}

// ── Prompt extraction ──

// Strip tagged blocks (<tag>content</tag>) and standalone tags, then trim.
function cleanUserText(raw: string): string {
  return raw.replace(/<(\w[\w-]*)[\s>][\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '').trim();
}

// Check if text is IDE/system noise rather than a real user prompt.
function isNoise(text: string): boolean {
  return /^(The user (opened|is viewing|has selected|scrolled)|ide_selection|gitStatus:|Current branch:)/i.test(text);
}

// Extract the first real user prompt from a transcript buffer.
function extractPromptFromText(content: string): string | null {
  const lines = content.split('\n');
  for (const line of lines) {
    // C2 : le verdict sur une ligne vient de la primitive commune du moteur.
    // Ici le silence RESTE le bon comportement, et pour une raison vérifiée en
    // exécutant plutôt que supposée : la fenêtre est bornée (256 Ko puis 1 Mo)
    // et coupe en plein milieu de ligne — une fenêtre décalée d'une frontière
    // rend bien `{"type":"user","message":{`. Une trace sur cet échec-là se
    // déclencherait à chaque lecture : du bruit de routine, pas un signal.
    // `isRecord(o)` remplace le filet qu'offrait `o.type` en levant sur une
    // ligne `null` — même issue pour `o` seul (cette ligne est ignorée), gardée
    // explicite. Aucun frère en jeu à ce niveau : une ligne ne porte qu'un `o`.
    //
    // Le `try` qui suit reste un vrai filet pour deux choses, TOUTES DEUX
    // reproduites par CAST plutôt que par garde ci-dessous, jamais filtrées :
    // `block.type` lève si un bloc du tableau `c` est `null`/`undefined`, et
    // `cleanUserText(block.text)` lève si un bloc `text` n'a pas de champ
    // `text`. Un garde (`isRecord(block)`) SAUTERAIT le bloc cassé au lieu de
    // laisser l'exception remonter — ce qui changerait qui gagne : l'original
    // abandonne la ligne ENTIÈRE dès le premier bloc cassé, frères valides
    // compris, revue du 2026-08-14 (constat 2).
    const verdict = decodeJsonlLine(line);
    if (!verdict || !verdict.ok) continue;
    const o = verdict.value;
    if (!isRecord(o)) continue;
    try {
      if (o.type === 'user' || o.type === 'human') {
        const message = isRecord(o.message) ? o.message : null;
        const c: unknown = (message && message.content) || o.content;
        if (typeof c === 'string') {
          const clean = cleanUserText(c);
          if (clean && clean.length > 5 && !isNoise(clean)) return clean.slice(0, 120);
        }
        if (Array.isArray(c)) {
          const blocks: unknown[] = c;
          for (const block of blocks) {
            // Cast, jamais `isRecord` : un bloc `null`/`undefined` doit lever
            // ICI, comme `block.type` de l'original — voir le commentaire
            // au-dessus du `try`.
            const b = block as { type?: unknown; text?: unknown };
            if (b.type === 'text') {
              const text = cleanUserText(b.text as string);
              if (text && text.length > 5 && !text.startsWith('{') && !isNoise(text)) return text.slice(0, 120);
            }
          }
        }
      }
    } catch {}
  }
  return null;
}

// Stream up to `maxBytes` from the transcript and try to extract the first
// user prompt. Returns null if not found in the window, string otherwise.
async function readPromptBounded(transcriptPath: string, maxBytes: number): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = fs.createReadStream(transcriptPath, { end: maxBytes - 1 });
    // `'data'` accepte `string | Buffer` : aucun encodage n'est posé sur ce
    // flux, il rend TOUJOURS un `Buffer` à l'exécution — le repli `string`
    // ne sert qu'à satisfaire la signature de l'événement.
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      chunks.push(buf);
      total += buf.length;
    });
    stream.on('end', () => {
      try {
        const text = Buffer.concat(chunks, total).toString('utf8');
        resolve(extractPromptFromText(text));
      } catch { resolve(null); }
    });
    stream.on('error', () => resolve(null));
  });
}

// Lazy, cached, bounded first-prompt reader. Fire-and-forget friendly.
async function ensureFirstPrompt(sessionFile: string): Promise<string | null> {
  const id = idFromPath(sessionFile);
  const rec = sessionIndex.get(id);
  if (!rec) return null;
  if (typeof rec.promptCache === 'string') return rec.promptCache;
  const tp = await getTranscriptPath(sessionFile);
  if (!tp) { rec.promptCache = null; return null; }
  try { await fsp.access(tp); } catch { rec.promptCache = null; return null; }

  // First attempt: 256 KB. Widen to 1 MB on miss.
  const windows = [256 * 1024, 1024 * 1024];
  const start = rec.promptWindow ? windows.findIndex(w => w > rec.promptWindow) : 0;
  // Tranché plutôt qu'indexé : `noUncheckedIndexedAccess` rendrait
  // `windows[i]` possiblement `undefined` ; `slice` porte la même garantie
  // (bornes déjà réduites à ce qui reste à essayer) sans accès indexé.
  for (const w of windows.slice(Math.max(0, start))) {
    rec.promptWindow = w;
    const prompt = await readPromptBounded(tp, w);
    if (prompt) {
      rec.promptCache = prompt;
      broadcastSessionsChanged();
      return prompt;
    }
  }
  rec.promptCache = null;
  return null;
}

// ── Token-usage transcript tailing ──

// Dispatch a single transcript line to the per-agent adapter. Returns true
// when a token bucket was updated.
function parseTranscriptEvent(line: string, rec: SessionWithSlices): boolean {
  // `UsageRecord` (transcript-adapters/claude.ts, exporté) : `rec` porte
  // toujours au moins sa forme (mêmes deux champs `main`/`perAgent`, plus les
  // nôtres en plus) — cast à cette frontière plutôt qu'un troisième type local.
  return getAdapter(rec.agentSource).parseUsageLine(line, rec as UsageRecord);
}

// A "tail" tracks the append-only streaming of one JSONL file. A session has
// one tail for its main transcript plus one per discovered sub-agent
// transcript — same read/watch machinery for both, since each parsed line is
// self-describing (it carries isSidechain + agentId) and routes itself to the
// right token bucket.
function makeTail(filePath: string): Tail {
  return {
    path: filePath, offset: 0, leftover: '',
    watcher: null,
    _readInFlight: false, _readPending: false, _watchTimer: null,
  };
}

// Lazy initializer for the transcript slice on the session record. Holds the
// main transcript tail plus a per-sub-agent tail map under a single namespace
// so transcript.js doesn't stamp loose fields onto the shared record object.
function ensureTranscriptSlice(rec: SessionWithSlices): TranscriptSlice {
  if (!rec.transcript) {
    rec.transcript = {
      main: null,             // tail | null
      subagents: new Map(),   // agentId → tail
      _mainPending: false, _closed: false,
    };
  }
  return rec.transcript;
}

// Append-only streaming read of one tail's file. Preserves a line leftover for
// partial trailing writes. Same concurrency guard pattern as readAndBroadcast.
// `_closed` short-circuit guards against the race where deleteSession fires
// between the fs.watch debounce timer being scheduled (50ms) and it firing —
// without it we'd parse bytes into a `rec` already removed from sessionIndex
// and emit a stray SSE for a session the client just discarded.
async function readTailDelta(tail: Tail, rec: SessionWithSlices): Promise<void> {
  const tr = rec.transcript;
  if (!tr || tr._closed) return;
  if (tail._readInFlight) { tail._readPending = true; return; }
  tail._readInFlight = true;
  let fh;
  try {
    const stat = await fsp.stat(tail.path);
    const offset = tail.offset || 0;
    if (stat.size <= offset) return;
    const len = stat.size - offset;
    const buf = Buffer.alloc(len);
    fh = await fsp.open(tail.path, 'r');
    await fh.read(buf, 0, len, offset);
    await fh.close();
    fh = null;
    tail.offset = stat.size;
    const text = (tail.leftover || '') + buf.toString('utf8');
    const lines = text.split('\n');
    // `split('\n')` sur un texte non vide (la concaténation ci-dessus rend
    // toujours au moins une chaîne) rend toujours au moins un élément — `.pop()`
    // ne peut donc jamais rendre `undefined` ici ; le repli documente
    // l'invariant pour `noUncheckedIndexedAccess` sans changer d'issue.
    tail.leftover = lines.pop() ?? ''; // possibly incomplete tail
    let changed = false;
    for (const line of lines) {
      if (!line) continue;
      if (parseTranscriptEvent(line, rec)) changed = true;
    }
    if (changed) scheduleTokensBroadcast(rec.id, rec as TokensCarrierLike);
  } catch {
    if (fh) { try { await fh.close(); } catch {} }
  } finally {
    tail._readInFlight = false;
    if (tail._readPending) {
      tail._readPending = false;
      setImmediate(() => readTailDelta(tail, rec).catch(err => console.error(`[transcript] ${rec.id.slice(0, 8)}: re-read failed: ${err.message}`)));
    }
  }
}

// Open an fs.watch on a tail's file for live updates, debounced 50ms (Windows
// fires multiple change events per write). A file that can't be watched must
// not abort the rest of the session's token tracking.
function watchTail(tail: Tail, rec: SessionWithSlices): void {
  try {
    tail.watcher = fs.watch(tail.path, () => {
      if (tail._watchTimer) clearTimeout(tail._watchTimer);
      tail._watchTimer = setTimeout(() => {
        tail._watchTimer = null;
        readTailDelta(tail, rec).catch(err => console.error(`[transcript] ${rec.id.slice(0, 8)}: watch read failed: ${err.message}`));
      }, 50);
    });
  } catch { /* unwatched file → its tokens just stop updating live */ }
}

// Sub-agent transcripts live next to the main one:
//   <dir>/<sessionBasename>/subagents/agent-<agentId>.jsonl
// Claude Code (≥ ~2.1.143) no longer inlines sub-agent activity in the parent
// transcript — each sub-agent gets its own file. Re-scanned on every call so
// agents spawned mid-session are picked up shortly after their first event;
// already-tracked files are skipped. The discovery loop registers each new
// tail synchronously (no await in its body) so concurrent callers can't
// double-register the same file.
async function ensureSubagentTails(tr: TranscriptSlice, rec: SessionWithSlices): Promise<void> {
  if (!tr.main) return;
  const mainPath = tr.main.path;
  const subDir = path.join(
    path.dirname(mainPath),
    path.basename(mainPath, '.jsonl'),
    'subagents',
  );
  let files: string[];
  try { files = await fsp.readdir(subDir); }
  catch { return; } // no subagents/ dir → session has no sub-agents (yet)
  const fresh: Tail[] = [];
  for (const f of files) {
    const m = /^agent-(.+)\.jsonl$/.exec(f);
    if (!m) continue;
    // Le groupe capturant `(.+)` exige au moins un caractère : dès que `m`
    // matche, `m[1]` est toujours défini — le repli documente l'invariant
    // pour `noUncheckedIndexedAccess` sans changer d'issue.
    const agentId = m[1] ?? '';
    if (tr.subagents.has(agentId)) continue;
    const tail = makeTail(path.join(subDir, f));
    tr.subagents.set(agentId, tail);
    watchTail(tail, rec);
    fresh.push(tail);
  }
  await Promise.all(fresh.map(t => readTailDelta(t, rec)));
}

// Discover the main transcript_path, do an initial full-file read to catch up,
// open fs.watch for live updates, then discover + tail any sub-agent
// transcripts. The main-transcript half runs once (guarded by `_mainPending`
// against overlapping fire-and-forget callers); the sub-agent scan runs on
// every call so newly-spawned agents are picked up.
async function ensureTranscriptWatcher(sessionFile: string): Promise<void> {
  const id = idFromPath(sessionFile);
  // `SessionRecord` (session-index.ts, scellé) n'expose `transcript`/`tokens`
  // que via son index signature ouverte ; ce cast pose la vue plus précise
  // que CE fichier construit et lit lui-même sur le même enregistrement (voir
  // `SessionWithSlices`).
  const rec = sessionIndex.get(id) as SessionWithSlices | undefined;
  if (!rec) return;
  // Skip transcript watching when the adapter doesn't expose token usage.
  // Marking the bucket lets consumers distinguish "unsupported" from "zero",
  // and avoids a wasted fs.watch handle per session.
  const adapter = getAdapter(rec.agentSource);
  if (!adapter.tokensSupported) {
    ensureTokens(rec);
    // `ensureTokens` pose `rec.tokens` inconditionnellement (voir sa note
    // dans tokens.ts), mais sa frontière `unknown` ne le fait pas SAVOIR à
    // TypeScript ici — même garde qu'ailleurs dans le produit après le même
    // appel (tokens.ts, transcript-adapters/claude.ts).
    if (rec.tokens) rec.tokens.unsupported = true;
    return;
  }
  const tr = ensureTranscriptSlice(rec);

  if (!tr.main && !tr._mainPending) {
    tr._mainPending = true;
    try {
      const tp = await getTranscriptPath(sessionFile);
      if (!tp) {
        console.error(`[tokens] ${id.slice(0,8)}: no transcript_path in hook events yet`);
        flagTranscriptMissing(rec, id);
        return;
      }
      // The transcript file is often not on disk yet when SessionStart is
      // processed — treat a miss as transient (the next event retries),
      // never as a permanent failure.
      try { await fsp.access(tp); }
      catch {
        console.error(`[tokens] ${id.slice(0,8)}: transcript not on disk yet at ${tp}`);
        flagTranscriptMissing(rec, id);
        return;
      }
      ensureTokens(rec);
      const tail = makeTail(tp);
      tr.main = tail;
      await readTailDelta(tail, rec);
      watchTail(tail, rec);
      // Discovery succeeded — clear any earlier "transcript missing" state and
      // push a snapshot so the UI swaps its placeholder for live tokens.
      if (rec.tokens) rec.tokens.transcriptMissing = false;
      scheduleTokensBroadcast(id, rec as TokensCarrierLike);
      if (rec.tokens) {
        console.error(`[tokens] ${id.slice(0,8)}: main=${tokenSum(rec.tokens.main)} perAgent=${rec.tokens.perAgent.size}`);
      }
    } finally {
      tr._mainPending = false;
    }
  }

  await ensureSubagentTails(tr, rec);
}

// Mark a session's token bucket as "transcript not located yet" and broadcast
// it, so the UI shows an explicit state instead of a blank pill. Transient:
// ensureTranscriptWatcher clears it as soon as discovery succeeds.
function flagTranscriptMissing(rec: SessionWithSlices, id: string): void {
  ensureTokens(rec);
  if (rec.tokens) rec.tokens.transcriptMissing = true;
  scheduleTokensBroadcast(id, rec as TokensCarrierLike);
}

// Close every transcript watcher (main + sub-agents) and clear pending timers
// — called by deleteSession. Sets _closed so any debounced fs.watch callback
// that still fires within the 50ms window after deletion is a no-op instead of
// a stray SSE broadcast.
function closeTranscriptResources(rec: SessionRecord | null | undefined): void {
  if (!rec) return;
  // Voir `ensureTranscriptWatcher` : même cast vers la vue plus précise que ce
  // fichier construit et lit lui-même sur `SessionRecord` (scellé).
  const tr = (rec as SessionWithSlices).transcript;
  if (!tr) return;
  tr._closed = true;
  closeTail(tr.main);
  for (const tail of tr.subagents.values()) closeTail(tail);
}

function closeTail(tail: Tail | null): void {
  if (!tail) return;
  if (tail.watcher) { try { tail.watcher.close(); } catch {} }
  if (tail._watchTimer) clearTimeout(tail._watchTimer);
}

// Exposed for tests:
const _internals = {
  readFirstLine, extractPromptFromText, parseTranscriptEvent,
  ensureTranscriptSlice, makeTail, ensureSubagentTails, readTailDelta,
};

export {
  getTranscriptPath,
  ensureFirstPrompt,
  ensureTranscriptWatcher,
  closeTranscriptResources,
  _internals,
};
