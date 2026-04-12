/**
 * Thin wrapper around the bird CLI.
 * All functions return parsed JSON.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const BIRD = process.env.BIRD_PATH || 'bird';

function run(cmd, timeoutMs = 30000) {
  return JSON.parse(
    execSync(`${BIRD} ${cmd}`, { encoding: 'utf8', timeout: timeoutMs })
  );
}

/**
 * bird returns either an array or { tweets: [...] } — normalise to array.
 */
function toArray(parsed) {
  return Array.isArray(parsed) ? parsed : (parsed.tweets || []);
}

/**
 * Fetch bookmarks. Uses a temp file to work around bird's pipe buffering bug.
 */
export function fetchBookmarks(count = 20) {
  const useAll = count > 50;
  let cmd;
  if (useAll) {
    const maxPages = Math.max(Math.ceil(count / 20), 10);
    cmd = `bookmarks --all --max-pages ${maxPages} --json`;
  } else {
    cmd = `bookmarks -n ${count} --json`;
  }

  const tmpFile = path.join(os.tmpdir(), `btm-bookmarks-${Date.now()}.json`);
  try {
    execSync(`${BIRD} ${cmd} > "${tmpFile}"`, {
      timeout: useAll ? 180000 : 60000,
      shell: true
    });
    const parsed = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    let tweets = toArray(parsed);
    if (tweets.length > count) tweets = tweets.slice(0, count);
    return tweets;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

/**
 * Read a single tweet by ID.
 */
export function readTweet(tweetId) {
  try {
    return run(`read ${tweetId} --json`, 15000);
  } catch (e) {
    console.error(`  Could not fetch tweet ${tweetId}: ${e.message}`);
    return null;
  }
}

/**
 * Search tweets.
 */
export function searchTweets(query, count = 50) {
  try {
    const parsed = run(`search "${query}" -n ${count} --json`, 30000);
    return toArray(parsed);
  } catch (e) {
    console.error(`  Search failed ("${query}"): ${e.message}`);
    return [];
  }
}
