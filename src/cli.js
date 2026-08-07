#!/usr/bin/env node

/**
 * bookmarks_to_md -- fetch Twitter/X bookmarks via bird CLI and save as Markdown.
 *
 * Usage:
 *   node src/cli.js [--count N] [--output DIR] [--no-threads] [--auth-token TOKEN] [--ct0 TOKEN] [--bird-path PATH]
 *   node src/cli.js config [--batch-size N] [--battery-threshold N] [--bird-path PATH] [--output DIR] [--auth-token TOKEN] [--ct0 TOKEN]
 *   node src/cli.js status
 */

import fs from 'fs';
import path from 'path';
import { fetchBookmarks, RateLimitError } from './bird.js';
import { fetchThread } from './thread.js';
import { detectArticle, detectArticleAsync, fetchArticle } from './article.js';
import { tweetToMarkdown, threadToMarkdown, articleToMarkdown } from './markdown.js';
import { getProcessedIds, markProcessedBatch } from './state.js';
import { loadConfig, saveConfig, getConfigPath } from './config.js';

function parseArgs(argv) {
  const args = { command: null, count: null, output: null, threads: true, authToken: null, ct0: null, birdPath: null, batchSize: null, batteryThreshold: null };
  let i = 2;

  if (argv[i] && !argv[i].startsWith('--')) {
    args.command = argv[i];
    i++;
  }

  for (; i < argv.length; i++) {
    if (argv[i] === '--count' && argv[i + 1]) { args.count = parseInt(argv[++i], 10); }
    else if (argv[i] === '--output' && argv[i + 1]) { args.output = argv[++i]; }
    else if (argv[i] === '--no-threads') { args.threads = false; }
    else if (argv[i] === '--auth-token' && argv[i + 1]) { args.authToken = argv[++i]; }
    else if (argv[i] === '--ct0' && argv[i + 1]) { args.ct0 = argv[++i]; }
    else if (argv[i] === '--bird-path' && argv[i + 1]) { args.birdPath = argv[++i]; }
    else if (argv[i] === '--batch-size' && argv[i + 1]) { args.batchSize = parseInt(argv[++i], 10); }
    else if (argv[i] === '--battery-threshold' && argv[i + 1]) { args.batteryThreshold = parseInt(argv[++i], 10); }
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

  if (changed) {
    saveConfig(config);
    console.log('Config updated:');
  } else {
    console.log('Current config:');
  }
  console.log(`  Config file:        ${getConfigPath()}`);
  console.log(`  Batch size:         ${config.batchSize}`);
  console.log(`  Battery threshold:  ${config.batteryThreshold}%`);
  console.log(`  Bird path:          ${config.birdPath || '(use PATH)'}`);
  console.log(`  Output dir:         ${config.outputDir}`);
  console.log(`  Auth token:         ${config.authToken ? '****' + config.authToken.slice(-6) : '(not set)'}`);
  console.log(`  ct0:                ${config.ct0 ? '****' + config.ct0.slice(-6) : '(not set)'}`);
  process.exit(0);
}

// Resolve effective values: CLI flags override config
const authToken = args.authToken || config.authToken;
const ct0 = args.ct0 || config.ct0;
const birdPath = args.birdPath || config.birdPath;
const count = args.count || config.batchSize;
const outDir = args.output || config.outputDir;

if (authToken) process.env.AUTH_TOKEN = authToken;
if (ct0) process.env.CT0 = ct0;
if (birdPath) process.env.BIRD_PATH = birdPath;

ensureDir(outDir);

// --- status subcommand ---
if (args.command === 'status') {
  const processed = getProcessedIds();
  console.log(`Processed bookmarks: ${processed.size}`);
  console.log(`Output directory:    ${path.resolve(outDir)}`);
  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.md'));
  console.log(`Markdown files:      ${files.length}`);
  console.log(`Config file:         ${getConfigPath()}`);
  console.log(`Batch size:          ${config.batchSize}`);
  console.log(`Battery threshold:   ${config.batteryThreshold}%`);
  process.exit(0);
}

// --- Main fetch ---
async function main() {
  console.log(`Fetching ${count} bookmarks...`);
  const bookmarks = fetchBookmarks(count);
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
  let articlesFound = 0;
  const allProcessedIds = [];

  for (const bookmark of newBookmarks) {
    const tweetId = bookmark.id?.toString();
    const author = bookmark.author?.username || bookmark.user?.screen_name || 'unknown';
    process.stdout.write(`  @${author}/${tweetId} ... `);

    try {
      // Check for article (sync first, then async t.co expansion)
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
          allProcessedIds.push(tweetId);
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
        allProcessedIds.push(...thread.map(t => t.id));
      } else {
        const { filename, content } = tweetToMarkdown(bookmark);
        fs.writeFileSync(path.join(outDir, filename), content);
        console.log(`tweet -> ${filename}`);
        allProcessedIds.push(tweetId);
      }
      filesWritten++;

    } catch (e) {
      if (e instanceof RateLimitError) {
        console.log(`\nRate limited. Saving progress (${filesWritten} files written) and stopping.`);
        console.log('Next scheduled run will pick up remaining bookmarks.');
        break;
      }
      console.error(`error: ${e.message}`);
      allProcessedIds.push(tweetId);
      filesWritten++;
    }
  }

  if (allProcessedIds.length > 0) {
    markProcessedBatch(allProcessedIds);
  }

  console.log(`\nDone. Wrote ${filesWritten} files (${articlesFound} articles, ${threadsFound} threads). Output: ${path.resolve(outDir)}`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
