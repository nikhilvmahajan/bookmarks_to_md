/**
 * Convert tweet or thread to Markdown.
 */

function formatDate(dateStr) {
  if (!dateStr) return 'unknown';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function sanitizeFilename(str) {
  return str.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/_{2,}/g, '_').slice(0, 100);
}

/**
 * Build frontmatter block.
 */
function frontmatter(fields) {
  const lines = ['---'];
  for (const [key, val] of Object.entries(fields)) {
    if (val == null) continue;
    lines.push(`${key}: ${typeof val === 'string' && val.includes(':') ? `"${val}"` : val}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Render a single tweet's body (text + quoted tweet if any).
 */
function renderTweetBody(entry) {
  let body = entry.text || '';

  if (entry.quotedTweet) {
    const qt = entry.quotedTweet;
    const qtAuthor = qt.author?.username || qt.user?.screen_name || 'unknown';
    const qtText = qt.text || qt.full_text || '';
    body += `\n\n> **Quoted @${qtAuthor}:**\n> ${qtText.split('\n').join('\n> ')}`;
  }

  return body;
}

/**
 * Generate markdown for a standalone tweet.
 */
export function tweetToMarkdown(tweet) {
  const author = tweet.author?.username || tweet.user?.screen_name || 'unknown';
  const authorName = tweet.author?.name || tweet.user?.name || author;
  const tweetId = tweet.id?.toString();
  const url = `https://x.com/${author}/status/${tweetId}`;
  const date = formatDate(tweet.createdAt);
  const text = tweet.text || tweet.full_text || '';

  const fm = frontmatter({
    author: `@${author}`,
    author_name: authorName,
    tweet_id: tweetId,
    url,
    date,
    type: 'tweet'
  });

  let body = text;
  if (tweet.quotedTweet) {
    const qt = tweet.quotedTweet;
    const qtAuthor = qt.author?.username || qt.user?.screen_name || 'unknown';
    const qtText = qt.text || qt.full_text || '';
    body += `\n\n> **Quoted @${qtAuthor}:**\n> ${qtText.split('\n').join('\n> ')}`;
  }

  const content = `${fm}\n\n# @${author}\n\n${body}\n\n---\n*[Original tweet](${url}) | ${date}*\n`;

  const filename = `${sanitizeFilename(author)}-${tweetId}.md`;
  return { filename, content };
}

/**
 * Generate markdown for an X article.
 */
export function articleToMarkdown(tweet, article) {
  const author = tweet.author?.username || tweet.user?.screen_name || 'unknown';
  const authorName = tweet.author?.name || tweet.user?.name || author;
  const tweetId = tweet.id?.toString();
  const url = `https://x.com/${author}/status/${tweetId}`;
  const articleUrl = `https://x.com/i/article/${article.articleId}`;
  const date = formatDate(tweet.createdAt);

  const fm = frontmatter({
    author: `@${author}`,
    author_name: authorName,
    tweet_id: tweetId,
    article_id: article.articleId,
    url,
    article_url: articleUrl,
    date,
    type: 'article',
    title: article.title
  });

  let body = '';
  if (article.title) body += `## ${article.title}\n\n`;
  if (article.previewText && article.previewText !== article.content) {
    body += `*${article.previewText}*\n\n`;
  }
  if (article.content) {
    body += article.content;
  } else {
    body += '*Article content could not be fetched.*';
  }

  const content = `${fm}\n\n# Article by @${author}\n\n${body}\n\n---\n*[Original tweet](${url}) | [Article](${articleUrl}) | ${date}*\n`;

  const filename = `${sanitizeFilename(author)}-article-${article.articleId}.md`;
  return { filename, content };
}

/**
 * Generate markdown for a thread.
 */
export function threadToMarkdown(threadTweets) {
  const root = threadTweets[0];
  const author = root.author || 'unknown';
  const authorName = root.authorName || author;
  const rootId = root.id;
  const rootUrl = root.tweetUrl;
  const date = formatDate(root.createdAt);
  const total = threadTweets.length;

  const fm = frontmatter({
    author: `@${author}`,
    author_name: authorName,
    thread_root_id: rootId,
    url: rootUrl,
    date,
    type: 'thread',
    tweet_count: total
  });

  const parts = threadTweets.map((t, i) => {
    const marker = t.isBookmarked ? ' *(bookmarked)*' : '';
    const body = renderTweetBody(t);
    return `### ${i + 1}/${total}${marker}\n\n${body}\n\n*[Tweet](${t.tweetUrl}) | ${formatDate(t.createdAt)}*`;
  });

  const content = `${fm}\n\n# Thread by @${author} (${total} tweets)\n\n${parts.join('\n\n---\n\n')}\n`;

  const filename = `${sanitizeFilename(author)}-thread-${rootId}.md`;
  return { filename, content };
}
