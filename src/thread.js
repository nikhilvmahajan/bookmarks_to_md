/**
 * Thread detection and fetching.
 *
 * Uses `bird thread <id> --all --json` to fetch the full conversation thread.
 * Filters to self-reply tweets (same author) and returns them chronologically.
 * Returns null if the tweet is standalone (no other tweets by the same author).
 */

import { fetchThreadVia } from './bird.js';

function getAuthor(tweet) {
  return (tweet.author?.username || tweet.user?.screen_name || '').toLowerCase();
}

function toEntry(tweet, isBookmarked = false) {
  return {
    id: tweet.id?.toString(),
    author: tweet.author?.username || tweet.user?.screen_name || 'unknown',
    authorName: tweet.author?.name || tweet.user?.name || 'unknown',
    text: tweet.text || tweet.full_text || '',
    tweetUrl: `https://x.com/${tweet.author?.username || tweet.user?.screen_name || 'unknown'}/status/${tweet.id}`,
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
export function fetchThread(bookmark) {
  const authorUsername = getAuthor(bookmark);
  if (!authorUsername) return null;

  const bookmarkId = bookmark.id?.toString();
  const rawThread = fetchThreadVia(bookmarkId);

  if (!rawThread.length) return null;

  // Filter to only self-reply tweets (same author as bookmarked tweet)
  const selfReplies = rawThread.filter(t => getAuthor(t) === authorUsername);

  if (selfReplies.length <= 1) return null;

  // Sort chronologically by snowflake ID
  selfReplies.sort((a, b) => {
    try { return BigInt(a.id) < BigInt(b.id) ? -1 : 1; }
    catch { return String(a.id) < String(b.id) ? -1 : 1; }
  });

  // Mark the bookmarked tweet
  return selfReplies.map(t =>
    toEntry(t, t.id?.toString() === bookmarkId)
  );
}
