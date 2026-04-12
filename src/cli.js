#!/usr/bin/env node

/**
 * bookmarks_to_md — fetch Twitter/X bookmarks via bird CLI and save as Markdown.
 *
 * Usage:
 *   node src/cli.js [--count N] [--output DIR] [--no-threads] [--auth-token TOKEN] [--ct0 TOKEN] [--bird-path PATH]
 *
 * Options:
 *   --count N          Number of bookmarks to fetch (default: 20, use 9999 for all)
 *   --output DIR       Output directory (default: ./bookmarks)
 *   --no-threads       Skip thread detection/fetching
 *   --status           Show how many bookmarks have been processed
 *   --auth-token TOKEN Twitter auth_token cookie
 *   --ct0 TOKEN        Twitter ct0 cookie
 *   --bird-path PATH   Path to bird binary
 */

import fs from 'fs';
import path from 'path';
import { fetchBookmarks } from './bird.js';
import { fetchThread } from './thread.js';
import { tweetToMarkdown, threadToMarkdown } from './markdown.js';
import { getProcessedIds, markProcessedBatch } from './state.js';

function parseArgs(argv) {
  const args = { count: 20, output: './bookmarks', threads: true, status: false, authToken: null, ct0: null, birdPath: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--count' && argv[i + 1]) { args.count = parseInt(argv[++i], 10); }
    else if (argv[i] === '--output' && argv[i + 1]) { args.output = argv[++i]; }
    else if (argv[i] === '--no-threads') { args.threads = false; }
    else if (argv[i] === '--status') { args.status = true; }
    else if (argv[i] === '--auth-token' && argv[i + 1]) { args.authToken = argv[++i]; }
    else if (argv[i] === '--ct0' && argv[i + 1]) { args.ct0 = argv[++i]; }
    else if (argv[i] === '--bird-path' && argv[i + 1]) { args.birdPath = argv[++i]; }
  }
  return args;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const args = parseArgs(process.argv);

// Set env vars for bird auth if provided via CLI flags
if (args.authToken) process.env.AUTH_TOKEN = args.authToken;
if (args.ct0) process.env.CT0 = args.ct0;
if (args.birdPath) process.env.BIRD_PATH = args.birdPath;

const outDir = args.output;
ensureDir(outDir);

if (args.status) {
  const processed = getProcessedIds();
  console.log(`Processed bookmarks: ${processed.size}`);
  console.log(`Output directory: ${path.resolve(outDir)}`);
  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.md'));
  console.log(`Markdown files: ${files.length}`);
  process.exit(0);
}

// --- Main ---
console.log(`Fetching ${args.count} bookmarks...`);
const bookmarks = fetchBookmarks(args.count);
console.log(`Fetched ${bookmarks.length} bookmarks.`);

const processed = getProcessedIds();
const newBookmarks = bookmarks.filter(b => !processed.has(String(b.id)));
console.log(`New (unprocessed): ${newBookmarks.length}`);

if (newBookmarks.length === 0) {
  console.log('Nothing new to process.');
  process.exit(0);
}

let filesWritten = 0;
let threadsFound = 0;
const allProcessedIds = [];

for (const bookmark of newBookmarks) {
  const tweetId = bookmark.id?.toString();
  const author = bookmark.author?.username || bookmark.user?.screen_name || 'unknown';
  process.stdout.write(`  @${author}/${tweetId} ... `);

  // Check for thread
  let thread = null;
  if (args.threads) {
    thread = fetchThread(bookmark);
  }

  if (thread) {
    const { filename, content } = threadToMarkdown(thread);
    fs.writeFileSync(path.join(outDir, filename), content);
    console.log(`thread (${thread.length} tweets) → ${filename}`);
    threadsFound++;
    // Mark all tweet IDs in thread as processed
    allProcessedIds.push(...thread.map(t => t.id));
  } else {
    const { filename, content } = tweetToMarkdown(bookmark);
    fs.writeFileSync(path.join(outDir, filename), content);
    console.log(`tweet → ${filename}`);
    allProcessedIds.push(tweetId);
  }
  filesWritten++;
}

markProcessedBatch(allProcessedIds);

console.log(`\nDone. Wrote ${filesWritten} files (${threadsFound} threads). Output: ${path.resolve(outDir)}`);
