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

// bird could not reach X at all (machine offline, DNS down). Every later call
// in the same run fails too, so the run stops and keeps its queue as it is.
export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

function getBird() {
  return process.env.BIRD_PATH || 'bird';
}

function isRateLimit(e) {
  return e.message && (e.message.includes('429') || e.message.includes('Rate limit'));
}

// Exit 2 on these turns the scheduled sync off (deploy/ + scripts/after-fetch.sh),
// so look only at bird's own error output: e.message also holds the command
// line, and its tweet IDs and temp-file timestamps can contain "401".
// "Missing required credentials": bird found no tokens in config, env or browsers.
function isAuthFailure(e) {
  const err = String(e.stderr ?? '');
  return err.includes('HTTP 401') || err.includes('Could not authenticate') ||
    err.includes('Missing required credentials');
}

// Node's fetch() (which bird uses) reports every network-level failure as
// "fetch failed". The error codes cover a lower-level message. Look only at
// bird's error output, for the same reason as isAuthFailure.
function isNetworkError(e) {
  const err = String(e.stderr ?? '');
  return err.includes('fetch failed') ||
    /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH)\b/.test(err);
}

function run(cmd, timeoutMs = 30000) {
  try {
    return JSON.parse(
      execSync(`${getBird()} ${cmd}`, { encoding: 'utf8', timeout: timeoutMs })
    );
  } catch (e) {
    if (isRateLimit(e)) throw new RateLimitError(e.message);
    if (isAuthFailure(e)) {
      console.error('Twitter login missing or expired. Update tokens: node src/cli.js config --auth-token <v> --ct0 <v>');
      process.exit(2);
    }
    if (isNetworkError(e)) throw new NetworkError(String(e.stderr).trim());
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
      console.error('Twitter login missing or expired. Update tokens: node src/cli.js config --auth-token <v> --ct0 <v>');
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
    if (e instanceof RateLimitError || e instanceof NetworkError) throw e;
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
    if (e instanceof RateLimitError || e instanceof NetworkError) throw e;
    console.error(`  Search failed ("${query}"): ${e.message}`);
    return [];
  }
}

// Not --all: that pages through every reply by anyone, 1 s apart, and big
// conversations ran past the 60 s timeout (183 lost threads, 11-15 Nov).
// The author's own tweets come first. On 15 Nov, 10 pages matched --all for
// threads of 72, 106 and 113 tweets, in 20 s or less.
const THREAD_MAX_PAGES = 10;

/**
 * Fetch the conversation thread containing a tweet.
 * Throws on any failure. An empty list must mean "bird answered, no thread",
 * never "bird failed": the caller saves a single tweet for an empty list.
 */
export function fetchThreadVia(tweetId) {
  const parsed = run(`thread ${tweetId} --max-pages ${THREAD_MAX_PAGES} --json`, 60000);
  const tweets = toArray(parsed);
  // nextCursor set: the conversation has pages that were not fetched. They can
  // hold more of the thread, or only other people's replies.
  tweets.morePages = Boolean(parsed?.nextCursor);
  return tweets;
}
