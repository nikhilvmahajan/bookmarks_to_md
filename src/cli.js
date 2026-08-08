#!/usr/bin/env node

/**
 * bookmarks_to_md -- fetch Twitter/X bookmarks via bird CLI and save as Markdown.
 *
 * Two-phase approach:
 *   1. Listing: crawl all bookmarks into a local pending queue (paginated, resumable)
 *   2. Processing: pop batchSize items from pending, detect threads/articles, write .md
 *
 * Usage:
 *   node src/cli.js [--no-threads]
 *   node src/cli.js config [--batch-size N] [--battery-threshold N] [--bird-path PATH]
 *                          [--output DIR] [--auth-token TOKEN] [--ct0 TOKEN]
 *                          [--listing-pages N]
 *   node src/cli.js status
 *   node src/cli.js reset
 */

import fs from 'fs';
import path from 'path';
import { fetchBookmarksPage, RateLimitError } from './bird.js';
import { fetchThread } from './thread.js';
import { detectArticle, detectArticleAsync, fetchArticle } from './article.js';
import { tweetToMarkdown, threadToMarkdown, articleToMarkdown } from './markdown.js';
import { loadState, saveState, getKnownIds, addToPending, markProcessed } from './state.js';
import { loadConfig, saveConfig, getConfigPath } from './config.js';

function parseArgs(argv) {
  const args = {
    command: null, threads: true,
    authToken: null, ct0: null, birdPath: null, output: null,
    batchSize: null, batteryThreshold: null, listingPages: null
  };
  let i = 2;

  if (argv[i] && !argv[i].startsWith('--')) {
    args.command = argv[i];
    i++;
  }

  for (; i < argv.length; i++) {
    if (argv[i] === '--no-threads') { args.threads = false; }
    else if (argv[i] === '--auth-token' && argv[i + 1]) { args.authToken = argv[++i]; }
    else if (argv[i] === '--ct0' && argv[i + 1]) { args.ct0 = argv[++i]; }
    else if (argv[i] === '--bird-path' && argv[i + 1]) { args.birdPath = argv[++i]; }
    else if (argv[i] === '--output' && argv[i + 1]) { args.output = argv[++i]; }
    else if (argv[i] === '--batch-size' && argv[i + 1]) { args.batchSize = parseInt(argv[++i], 10); }
    else if (argv[i] === '--battery-threshold' && argv[i + 1]) { args.batteryThreshold = parseInt(argv[++i], 10); }
    else if (argv[i] === '--listing-pages' && argv[i + 1]) { args.listingPages = parseInt(argv[++i], 10); }
  }
  return args;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const args = parseArgs(process.argv);
const config = loadConfig();

// --- config subcommand ---
if (args.command === 'config') {
  let changed = false;
  if (args.batchSize != null) { config.batchSize = args.batchSize; changed = true; }
  if (args.batteryThreshold != null) { config.batteryThreshold = args.batteryThreshold; changed = true; }
  if (args.birdPath != null) { config.birdPath = args.birdPath; changed = true; }
  if (args.output != null) { config.outputDir = args.output; changed = true; }
  if (args.authToken != null) { config.authToken = args.authToken; changed = true; }
  if (args.ct0 != null) { config.ct0 = args.ct0; changed = true; }
  if (args.listingPages != null) { config.listingPages = args.listingPages; changed = true; }

  if (changed) {
    saveConfig(config);
    console.log('Config updated:');
  } else {
    console.log('Current config:');
  }
  console.log(`  Config file:        ${getConfigPath()}`);
  console.log(`  Batch size:         ${config.batchSize}`);
  console.log(`  Listing pages:      ${config.listingPages}`);
  console.log(`  Battery threshold:  ${config.batteryThreshold}%`);
  console.log(`  Bird path:          ${config.birdPath || '(use PATH)'}`);
  console.log(`  Output dir:         ${config.outputDir}`);
  console.log(`  Auth token:         ${config.authToken ? '****' + config.authToken.slice(-6) : '(not set)'}`);
  console.log(`  ct0:                ${config.ct0 ? '****' + config.ct0.slice(-6) : '(not set)'}`);
  process.exit(0);
}

// Apply auth
const authToken = args.authToken || config.authToken;
const ct0 = args.ct0 || config.ct0;
const birdPath = args.birdPath || config.birdPath;
const outDir = args.output || config.outputDir;
const batchSize = config.batchSize;
const listingPages = config.listingPages;

if (authToken) process.env.AUTH_TOKEN = authToken;
if (ct0) process.env.CT0 = ct0;
if (birdPath) process.env.BIRD_PATH = birdPath;

ensureDir(outDir);

// --- status subcommand ---
if (args.command === 'status') {
  const state = loadState();
  const total = state.pending.length + state.processed.length;
  console.log(`Total known:         ${total}`);
  console.log(`Pending queue:       ${state.pending.length}`);
  console.log(`Processed IDs:       ${state.processed.length}`);
  console.log(`Listing complete:    ${state.listingComplete}`);
  console.log(`Listing cursor:      ${state.listingCursor ? 'yes (resumable)' : 'none'}`);
  console.log(`Output directory:    ${path.resolve(outDir)}`);
  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.md'));
  console.log(`Markdown files:      ${files.length}`);
  console.log(`Batch size:          ${batchSize}`);
  console.log(`Listing pages/run:   ${listingPages}`);
  process.exit(0);
}

// --- reset subcommand ---
if (args.command === 'reset') {
  saveState({ pending: [], processed: [], listingComplete: false, listingCursor: null });
  console.log('State reset. Next run will re-crawl all bookmarks.');
  process.exit(0);
}

// --- Main ---
async function main() {
  const state = loadState();

  // === PHASE 1: LISTING ===
  if (!state.listingComplete) {
    console.log(`Listing bookmarks (${listingPages} pages, cursor: ${state.listingCursor ? 'resuming' : 'start'})...`);
    try {
      const { tweets, nextCursor } = fetchBookmarksPage(listingPages, state.listingCursor);
      const added = addToPending(state, tweets);
      console.log(`  Fetched ${tweets.length} bookmarks, ${added} new. Pending: ${state.pending.length}, total known: ${state.pending.length + state.processed.length}.`);

      if (nextCursor) {
        state.listingCursor = nextCursor;
        console.log(`  More pages available. Will continue next run.`);
      } else {
        state.listingComplete = true;
        state.listingCursor = null;
        console.log(`  Listing complete. Total pending: ${state.pending.length}`);
      }
      saveState(state);
    } catch (e) {
      if (e instanceof RateLimitError) {
        console.log('  Rate limited during listing. Saving progress.');
        saveState(state);
        process.exit(0);
      }
      throw e;
    }
  } else if (state.pending.length === 0) {
    // Steady state: listing done, queue empty. Check for new bookmarks.
    console.log('Checking for new bookmarks...');
    try {
      const { tweets } = fetchBookmarksPage(1, null);
      const added = addToPending(state, tweets);
      if (added > 0) {
        console.log(`  Found ${added} new bookmarks.`);
        saveState(state);
      } else {
        console.log('  No new bookmarks.');
        saveState(state);
        process.exit(0);
      }
    } catch (e) {
      if (e instanceof RateLimitError) {
        console.log('  Rate limited. Will retry next run.');
        process.exit(0);
      }
      throw e;
    }
  }

  // === PHASE 2: PROCESSING ===
  if (state.pending.length === 0) {
    console.log('Nothing to process.');
    process.exit(0);
  }

  const batch = state.pending.slice(0, batchSize);
  console.log(`\nProcessing ${batch.length} of ${state.pending.length} pending...`);

  let filesWritten = 0;
  let threadsFound = 0;
  let articlesFound = 0;

  for (const bookmark of batch) {
    const tweetId = bookmark.id?.toString();
    const author = bookmark.author?.username || bookmark.user?.screen_name || 'unknown';
    process.stdout.write(`  @${author}/${tweetId} ... `);

    try {
      // Check for article
      let articleInfo = detectArticle(bookmark);
      if (!articleInfo) {
        articleInfo = await detectArticleAsync(bookmark);
      }

      if (articleInfo) {
        const article = fetchArticle(bookmark, articleInfo.articleId);
        if (article) {
          const { filename, content } = articleToMarkdown(bookmark, article);
          fs.writeFileSync(path.join(outDir, filename), content);
          console.log(`article -> ${filename}${article.title ? ` ("${article.title}")` : ''}`);
          articlesFound++;
          markProcessed(state, [tweetId]);
          saveState(state);
          filesWritten++;
          continue;
        }
      }

      // Check for thread
      let thread = null;
      if (args.threads) {
        thread = fetchThread(bookmark);
      }

      if (thread) {
        const { filename, content } = threadToMarkdown(thread);
        fs.writeFileSync(path.join(outDir, filename), content);
        console.log(`thread (${thread.length} tweets) -> ${filename}`);
        threadsFound++;
        markProcessed(state, thread.map(t => t.id));
      } else {
        const { filename, content } = tweetToMarkdown(bookmark);
        fs.writeFileSync(path.join(outDir, filename), content);
        console.log(`tweet -> ${filename}`);
        markProcessed(state, [tweetId]);
      }
      saveState(state);
      filesWritten++;

    } catch (e) {
      if (e instanceof RateLimitError) {
        console.log(`\nRate limited. Saving progress (${filesWritten} files written).`);
        console.log(`${state.pending.length} pending remaining. Will continue next run.`);
        saveState(state);
        process.exit(0);
      }
      console.error(`error: ${e.message}`);
      markProcessed(state, [tweetId]);
      saveState(state);
      filesWritten++;
    }
  }

  console.log(`\nDone. Wrote ${filesWritten} files (${articlesFound} articles, ${threadsFound} threads).`);
  console.log(`Remaining pending: ${state.pending.length}. Output: ${path.resolve(outDir)}`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
