/**
 * Simple JSON file for tracking processed tweet IDs (deduplication).
 */

import fs from 'fs';

const STATE_FILE = './bookmarks/.state.json';

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { processed: [] };
  }
}

function save(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

/**
 * Return set of already-processed tweet IDs.
 */
export function getProcessedIds() {
  return new Set(load().processed.map(String));
}

/**
 * Mark a tweet ID (or thread root ID) as processed.
 */
export function markProcessed(id) {
  const state = load();
  const idStr = String(id);
  if (!state.processed.includes(idStr)) {
    state.processed.push(idStr);
    save(state);
  }
}

/**
 * Mark multiple IDs at once.
 */
export function markProcessedBatch(ids) {
  const state = load();
  for (const id of ids) {
    const idStr = String(id);
    if (!state.processed.includes(idStr)) {
      state.processed.push(idStr);
    }
  }
  save(state);
}
