/**
 * Persistent work queue.
 *
 * State structure:
 * {
 *   pending: [{...bookmark}, ...],  // full bookmark objects queued for processing
 *   processed: ["id1", "id2", ...], // tweet IDs already written to .md
 *   listingComplete: false,         // whether the full bookmark listing crawl is done
 *   listingCursor: null             // cursor for resuming the listing crawl
 * }
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, '..', '.bookmarks-state.json');

function emptyState() {
  return { pending: [], processed: [], listingComplete: false, listingCursor: null };
}

export function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    state.pending ??= [];
    state.processed ??= [];
    state.listingComplete ??= false;
    state.listingCursor ??= null;
    return state;
  } catch {
    return emptyState();
  }
}

export function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

export function getProcessedSet(state) {
  return new Set(state.processed.map(String));
}

export function getKnownIds(state) {
  const set = getProcessedSet(state);
  for (const b of state.pending) set.add(String(b.id));
  return set;
}

export function addToPending(state, bookmarks) {
  const known = getKnownIds(state);
  let added = 0;
  for (const b of bookmarks) {
    const id = String(b.id);
    if (!known.has(id)) {
      state.pending.push(b);
      known.add(id);
      added++;
    }
  }
  return added;
}

export function markProcessed(state, ids) {
  const idStrs = ids.map(String);
  for (const id of idStrs) {
    if (!state.processed.includes(id)) {
      state.processed.push(id);
    }
  }
  state.pending = state.pending.filter(b => !idStrs.includes(String(b.id)));
}
