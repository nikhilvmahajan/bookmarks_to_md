/**
 * X article detection and fetching.
 *
 * X articles are long-form posts. The content lives in the tweet's `article`
 * metadata and/or in the `text` field of the tweet (or its quotedTweet).
 * bird CLI returns this data via `bird read <id> --json`.
 */

import { readTweet, searchTweets } from './bird.js';
import { request } from 'https';
import { request as httpRequest } from 'http';

const ARTICLE_RE = /x\.com\/i\/article\/(\d+)/;

/**
 * Resolve a t.co URL to its destination without downloading the body.
 * Returns the final URL string, or null on failure.
 */
function expandTco(shortUrl) {
  return new Promise(resolve => {
    try {
      const url = new URL(shortUrl);
      const requester = url.protocol === 'https:' ? request : httpRequest;
      const req = requester(url, { method: 'HEAD', timeout: 8000 }, res => {
        const location = res.headers.location;
        if (location) {
          resolve(location);
        } else {
          resolve(shortUrl);
        }
        res.resume();
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Check if a bookmark contains or links to an X article.
 * Returns { articleId, source } or null.
 */
export function detectArticle(bookmark) {
  // Direct article metadata on the tweet
  if (bookmark.article?.id || bookmark.article?.title) {
    return { articleId: bookmark.article.id || bookmark.id, source: 'tweet' };
  }

  // Article metadata on quoted tweet
  if (bookmark.quotedTweet?.article?.id || bookmark.quotedTweet?.article?.title) {
    return { articleId: bookmark.quotedTweet.article.id || bookmark.quotedTweet.id, source: 'quoted' };
  }

  // URL in entities pointing to x.com/i/article/<id>
  const urls = bookmark.entities?.urls || [];
  for (const u of urls) {
    const expanded = u.expanded_url || u.url || '';
    const match = expanded.match(ARTICLE_RE);
    if (match) return { articleId: match[1], source: 'url' };
  }

  // Check text for article URL as last resort
  const text = bookmark.text || bookmark.full_text || '';
  const textMatch = text.match(ARTICLE_RE);
  if (textMatch) return { articleId: textMatch[1], source: 'text' };

  return null;
}

/**
 * Async version that expands t.co links before checking.
 * Call this when detectArticle() returns null but the tweet has t.co URLs.
 */
export async function detectArticleAsync(bookmark) {
  const sync = detectArticle(bookmark);
  if (sync) return sync;

  // Collect t.co URLs from entities and text
  const tcoUrls = new Set();
  const urls = bookmark.entities?.urls || [];
  for (const u of urls) {
    const raw = u.url || '';
    if (raw.includes('t.co/')) tcoUrls.add(raw);
  }
  const text = bookmark.text || bookmark.full_text || '';
  const tcoMatches = text.match(/https?:\/\/t\.co\/\S+/g) || [];
  for (const m of tcoMatches) tcoUrls.add(m);

  if (tcoUrls.size === 0) return null;

  // Expand each and check
  for (const tco of tcoUrls) {
    const expanded = await expandTco(tco);
    if (expanded) {
      const match = expanded.match(ARTICLE_RE);
      if (match) return { articleId: match[1], source: 'tco-expanded' };
    }
  }

  return null;
}

/**
 * Extract article content from tweet data.
 * Returns { title, previewText, content, articleId } or null.
 */
function extractArticle(tweetData, articleId) {
  let articleContent = tweetData.text || '';
  let articleMeta = tweetData.article || {};

  // When someone quotes an X article, the full content is in quotedTweet
  const quotedTweet = tweetData.quotedTweet;
  if (quotedTweet) {
    const quotedContent = quotedTweet.text || '';
    const quotedMeta = quotedTweet.article || {};

    const mainHasMeta = articleMeta.title || articleMeta.previewText;
    const quotedHasMeta = quotedMeta.title || quotedMeta.previewText;

    if (quotedContent.length > articleContent.length) {
      articleContent = quotedContent;
      if (quotedHasMeta) articleMeta = quotedMeta;
    } else if (quotedHasMeta && !mainHasMeta) {
      articleMeta = quotedMeta;
      if (quotedContent.length > 500) articleContent = quotedContent;
    }
  }

  const hasArticleMeta = articleMeta.title || articleMeta.previewText;
  const hasArticleContent = articleContent.length > 500;

  if (hasArticleMeta || hasArticleContent) {
    return {
      articleId,
      title: articleMeta.title || null,
      previewText: articleMeta.previewText || null,
      content: articleContent
    };
  }
  return null;
}

/**
 * Fetch full article content for a bookmark.
 * Tries: 1) bird read on bookmark tweet, 2) search for original article tweet, 3) read that.
 * Returns { articleId, title, previewText, content } or null.
 */
export function fetchArticle(bookmark, articleId) {
  const tweetId = bookmark.id?.toString();

  // 1) Read the bookmarked tweet itself
  if (tweetId) {
    const tweetData = readTweet(tweetId);
    if (tweetData) {
      const result = extractArticle(tweetData, articleId);
      if (result) return result;
      console.log(`  Bookmarked tweet is a share, searching for original...`);
    }
  }

  // 2) Search for the original article tweet
  const searchQuery = `url:x.com/i/article/${articleId}`;
  const results = searchTweets(searchQuery, 5);
  for (const tweet of results) {
    // Prefer tweets with article metadata
    if (tweet.article?.title || tweet.article?.previewText) {
      const result = extractArticle(tweet, articleId);
      if (result) return result;
    }
  }

  // Try first search result even without metadata
  if (results.length > 0) {
    const first = results[0];
    // If search result has enough content, use it
    const searchContent = first.text || first.quotedTweet?.text || '';
    if (searchContent.length > 500) {
      const result = extractArticle(first, articleId);
      if (result) return result;
    }

    // Read the full tweet
    const fullTweet = readTweet(first.id?.toString());
    if (fullTweet) {
      const result = extractArticle(fullTweet, articleId);
      if (result) return result;
    }
  }

  // 3) Return whatever metadata we have from the bookmark itself
  const meta = bookmark.article || bookmark.quotedTweet?.article;
  if (meta) {
    return {
      articleId,
      title: meta.title || null,
      previewText: meta.previewText || null,
      content: null
    };
  }

  return null;
}
