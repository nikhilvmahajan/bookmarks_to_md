/**
 * Thread detection and fetching.
 *
 * Given a tweet, determines if it's part of a self-reply thread.
 * If so, fetches the full thread (backwards to root, forwards to end).
 * Returns null if the tweet is standalone.
 */

import { readTweet, searchTweets } from './bird.js';

function getAuthor(tweet) {
  return (tweet.author?.username || tweet.user?.screen_name || '').toLowerCase();
}

function getText(tweet) {
  return tweet.text || tweet.full_text || '';
}

function getTweetUrl(tweet) {
  const user = tweet.author?.username || tweet.user?.screen_name || 'unknown';
  return `https://x.com/${user}/status/${tweet.id}`;
}

function toEntry(tweet, isBookmarked = false) {
  return {
    id: tweet.id?.toString(),
    author: tweet.author?.username || tweet.user?.screen_name || 'unknown',
    authorName: tweet.author?.name || tweet.user?.name || 'unknown',
    text: getText(tweet),
    tweetUrl: getTweetUrl(tweet),
    createdAt: tweet.createdAt,
    isBookmarked,
    inReplyToStatusId: tweet.inReplyToStatusId?.toString() || null,
    media: tweet.media || tweet.entities?.media || null,
    quotedTweet: tweet.quotedTweet || null
  };
}

/**
 * Fetch full thread for a tweet. Returns array of tweet entries (chronological)
 * or null if it's a standalone tweet.
 */
export function fetchThread(bookmark, maxDepth = 50) {
  const authorUsername = getAuthor(bookmark);
  if (!authorUsername) return null;

  const bookmarkId = bookmark.id?.toString();
  const visited = new Set([bookmarkId]);

  // --- Walk backwards to thread root ---
  const before = [];
  let current = bookmark;
  let depth = 0;

  while (current.inReplyToStatusId && depth < maxDepth) {
    const parentId = current.inReplyToStatusId?.toString();
    if (!parentId || visited.has(parentId)) break;
    visited.add(parentId);

    const parent = readTweet(parentId);
    if (!parent) break;

    if (getAuthor(parent) !== authorUsername) break;

    before.unshift(toEntry(parent));
    current = parent;
    depth++;
  }

  // --- Bookmarked tweet ---
  const bookmarkedEntry = toEntry(bookmark, true);

  // --- Walk forwards via search ---
  const after = [];
  try {
    const username = bookmark.author?.username || bookmark.user?.screen_name;
    const candidates = searchTweets(`from:${username} to:${username}`, 50);

    const threadIds = new Set([...before.map(t => t.id), bookmarkId]);
    let changed = true;
    const pool = [...candidates];

    while (changed && after.length < maxDepth) {
      changed = false;
      for (let i = pool.length - 1; i >= 0; i--) {
        const c = pool[i];
        const cId = c.id?.toString();
        const replyToId = c.inReplyToStatusId?.toString();
        if (!cId || visited.has(cId) || !replyToId || !threadIds.has(replyToId)) continue;
        if (getAuthor(c) !== authorUsername) continue;

        visited.add(cId);
        threadIds.add(cId);
        after.push(toEntry(c));
        pool.splice(i, 1);
        changed = true;
      }
    }

    after.sort((a, b) => {
      try { return BigInt(a.id) < BigInt(b.id) ? -1 : 1; }
      catch { return String(a.id) < String(b.id) ? -1 : 1; }
    });
  } catch (e) {
    console.error(`  Thread forward search failed: ${e.message}`);
  }

  const allTweets = [...before, bookmarkedEntry, ...after];
  if (allTweets.length <= 1) return null;
  return allTweets;
}
