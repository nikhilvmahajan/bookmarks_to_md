/**
 * Thin wrapper around the bird CLI.
 * All functions return parsed JSON.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimitError';
  }
}

function getBird() {
  return process.env.BIRD_PATH || 'bird';
}

function isRateLimit(e) {
  return e.message && (e.message.includes('429') || e.message.includes('Rate limit'));
}

function isAuthFailure(e) {
  return e.message && (e.message.includes('401') || e.message.includes('Could not authenticate'));
}

function run(cmd, timeoutMs = 30000) {
  try {
    return JSON.parse(
      execSync(`${getBird()} ${cmd}`, { encoding: 'utf8', timeout: timeoutMs })
    );
  } catch (e) {
    if (isRateLimit(e)) throw new RateLimitError(e.message);
    if (isAuthFailure(e)) {
      console.error('Twitter session expired. Update tokens: node src/cli.js config --auth-token <v> --ct0 <v>');
      process.exit(2);
    }
    throw e;
  }
}

/**
 * bird returns either an array or { tweets: [...] } -- normalise to array.
 */
function toArray(parsed) {
  return Array.isArray(parsed) ? parsed : (parsed.tweets || []);
}

/**
 * Fetch a chunk of bookmarks using paginated mode.
 * Returns { tweets: [...], nextCursor: string|null }.
 */
export function fetchBookmarksPage(maxPages = 10, cursor = null) {
  let cmd = `bookmarks --all --max-pages ${maxPages} --json`;
  if (cursor) cmd += ` --cursor "${cursor}"`;

  const tmpFile = path.join(os.tmpdir(), `btm-bookmarks-${Date.now()}.json`);
  try {
    execSync(`${getBird()} ${cmd} > "${tmpFile}"`, {
      timeout: maxPages * 20000,
      shell: true
    });
    const raw = fs.readFileSync(tmpFile, 'utf8');
    const parsed = JSON.parse(raw);
    const tweets = toArray(parsed);
    const nextCursor = parsed.nextCursor || null;
    return { tweets, nextCursor };
  } catch (e) {
    if (isRateLimit(e)) throw new RateLimitError(e.message);
    if (isAuthFailure(e)) {
      console.error('Twitter session expired. Update tokens: node src/cli.js config --auth-token <v> --ct0 <v>');
      process.exit(2);
    }
    throw e;
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
    if (e instanceof RateLimitError) throw e;
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
    if (e instanceof RateLimitError) throw e;
    console.error(`  Search failed ("${query}"): ${e.message}`);
    return [];
  }
}

/**
 * Fetch the full conversation thread containing a tweet.
 */
export function fetchThreadVia(tweetId) {
  try {
    const parsed = run(`thread ${tweetId} --all --json`, 60000);
    return toArray(parsed);
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    console.error(`  Could not fetch thread for ${tweetId}: ${e.message}`);
    return [];
  }
}
