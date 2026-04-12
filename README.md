# bookmarks_to_md

A simple CLI tool that fetches your Twitter/X bookmarks and saves them as clean Markdown files. Threads are automatically detected and saved as a single file.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [bird CLI](https://www.npmjs.com/package/@steipete/bird) — Twitter/X API client that uses your browser session cookies

Install bird:

```bash
npm install -g @steipete/bird
```

## Setup

Clone or download this repo, then:

```bash
cd bookmarks_to_md
```

No `npm install` needed — zero dependencies.

## Authentication

You need your Twitter/X session cookies. To get them:

1. Open [x.com](https://x.com) in your browser and log in
2. Open DevTools (F12) -> Application -> Cookies -> `https://x.com`
3. Copy the values for `auth_token` and `ct0`

Pass them via CLI flags:

```bash
node src/cli.js --auth-token YOUR_AUTH_TOKEN --ct0 YOUR_CT0
```

Or via environment variables:

```bash
AUTH_TOKEN=xxx CT0=xxx node src/cli.js
```

## Usage

```bash
# Fetch 20 most recent bookmarks (default)
node src/cli.js --auth-token TOKEN --ct0 CT0

# Fetch 100 bookmarks
node src/cli.js --count 100 --auth-token TOKEN --ct0 CT0

# Fetch all bookmarks
node src/cli.js --count 9999 --auth-token TOKEN --ct0 CT0

# Save to a custom directory
node src/cli.js --output ./my-bookmarks --auth-token TOKEN --ct0 CT0

# Skip thread detection (faster, but threads won't be merged)
node src/cli.js --no-threads --auth-token TOKEN --ct0 CT0

# Check how many bookmarks have been processed
node src/cli.js --status

# Specify bird binary path (if not on PATH)
node src/cli.js --bird-path /path/to/bird --auth-token TOKEN --ct0 CT0
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--count N` | `20` | Number of bookmarks to fetch. Use `9999` to fetch all. |
| `--output DIR` | `./bookmarks` | Directory where Markdown files are saved. |
| `--no-threads` | off | Skip thread detection and fetching. |
| `--status` | off | Show processing stats and exit. |
| `--auth-token TOKEN` | — | Twitter `auth_token` cookie value. |
| `--ct0 TOKEN` | — | Twitter `ct0` cookie value. |
| `--bird-path PATH` | `bird` | Full path to the bird binary. |

## Output

Each bookmark becomes a Markdown file in the output directory:

- **Standalone tweets** -> `username-tweetid.md`
- **Threads** -> `username-thread-rootid.md` (all tweets in one file)

Every file includes YAML frontmatter with metadata (author, date, URL, type, tweet ID).

### Example: standalone tweet

```markdown
---
author: @elonmusk
tweet_id: 1234567890
url: https://x.com/elonmusk/status/1234567890
date: 2025-03-15 14:30:00 UTC
type: tweet
---

# @elonmusk

The tweet text goes here...

---
*[Original tweet](https://x.com/elonmusk/status/1234567890) | 2025-03-15 14:30:00 UTC*
```

### Example: thread

```markdown
---
author: @someuser
thread_root_id: 1234567890
url: https://x.com/someuser/status/1234567890
date: 2025-03-15 14:30:00 UTC
type: thread
tweet_count: 5
---

# Thread by @someuser (5 tweets)

### 1/5

First tweet in the thread...

---

### 2/5

Second tweet...

---

### 3/5 *(bookmarked)*

This is the tweet you actually bookmarked...
```

## Deduplication

Processed bookmark IDs are tracked in `./bookmarks/.state.json`. Running the tool again will skip already-processed bookmarks, so you can safely re-run it without creating duplicates.

## Thread Detection

When a bookmarked tweet is part of a self-reply thread, the tool:

1. **Walks backwards** from the bookmarked tweet to the thread root (following `inReplyToStatusId`)
2. **Searches forwards** to find continuation tweets after the bookmarked tweet
3. Combines everything into a single Markdown file in chronological order

The bookmarked tweet is marked with *(bookmarked)* in the thread output. Thread traversal stops at 50 tweets in each direction or when the author changes (i.e., it only follows self-reply threads).

## License

[MIT](LICENSE)
