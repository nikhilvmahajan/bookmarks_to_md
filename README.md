# bookmarks_to_md

A simple CLI tool that fetches your Twitter/X bookmarks and saves them as clean Markdown files. Threads are automatically detected and saved as a single file. X articles are fetched with full content.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [bird CLI](https://www.npmjs.com/package/@steipete/bird) -- Twitter/X API client that uses your browser session cookies

Install bird:

```bash
npm install -g @steipete/bird
```

## Setup

Clone or download this repo, then:

```bash
cd bookmarks_to_md
```

No `npm install` needed -- zero dependencies.

## Authentication

You need your Twitter/X session cookies. To get them:

1. Open [x.com](https://x.com) in your browser and log in
2. Open DevTools (F12) -> Application -> Cookies -> `https://x.com`
3. Copy the values for `auth_token` and `ct0`

Save them to config (one-time):

```bash
node src/cli.js config --auth-token YOUR_AUTH_TOKEN --ct0 YOUR_CT0 --bird-path /path/to/bird
```

Or pass them per-run via CLI flags or environment variables:

```bash
node src/cli.js --auth-token TOKEN --ct0 CT0
AUTH_TOKEN=xxx CT0=xxx node src/cli.js
```

## Usage

```bash
# Fetch bookmarks (uses batch size from config, default 25)
node src/cli.js

# Fetch a specific number
node src/cli.js --count 100

# Fetch all bookmarks
node src/cli.js --count 9999

# Save to a custom directory
node src/cli.js --output ./my-bookmarks

# Skip thread detection (faster, but threads won't be merged)
node src/cli.js --no-threads

# Check processing stats
node src/cli.js status

# View or update config
node src/cli.js config
node src/cli.js config --batch-size 50 --battery-threshold 30
```

## Configuration

Settings are stored in `.bookmarks-config.json`. View or update via:

```bash
node src/cli.js config                          # show current config
node src/cli.js config --batch-size 50          # change batch size
node src/cli.js config --battery-threshold 30   # change battery threshold
node src/cli.js config --output ./my-bookmarks  # change output directory
```

| Setting | Default | Description |
|---------|---------|-------------|
| `batchSize` | `25` | Number of bookmarks to fetch per run. |
| `batteryThreshold` | `50` | Minimum battery % to proceed (when on battery). |
| `birdPath` | `null` | Full path to the bird binary. `null` uses PATH. |
| `outputDir` | `./bookmarks` | Directory where Markdown files are saved. |
| `authToken` | `null` | Twitter `auth_token` cookie value. |
| `ct0` | `null` | Twitter `ct0` cookie value. |

CLI flags (`--count`, `--output`, `--auth-token`, `--ct0`, `--bird-path`) override config values for that run.

## Automatic Scheduling

The tool can run automatically on a schedule using Windows Task Scheduler.

### Install the scheduled task

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1
```

This registers a task called "Twitter Bookmarks Sync" that:

- Triggers at logon (2-minute delay), then repeats every 15 minutes
- Checks battery: skips if on battery and below threshold (default 50%)
- Fetches one batch of bookmarks per run (default 25)
- Logs to `logs/sync.log`

### Customize the interval

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1 -IntervalMinutes 30
```

### Run it manually

```powershell
Start-ScheduledTask -TaskName 'Twitter Bookmarks Sync'
```

### Remove the scheduled task

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1 -Uninstall
```

### Expired tokens

When session cookies expire, the sync logs an error and exits. Update tokens:

```bash
node src/cli.js config --auth-token NEW_TOKEN --ct0 NEW_CT0
```

## Output

Each bookmark becomes a Markdown file in the output directory:

- **Standalone tweets** -> `username-tweetid.md`
- **Threads** -> `username-thread-rootid.md` (all tweets in one file)
- **Articles** -> `username-article-articleid.md` (full X article content)

Every file includes YAML frontmatter with metadata (author, date, URL, type).

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

### 3/5 *(bookmarked)*

This is the tweet you actually bookmarked...
```

### Example: article

```markdown
---
author: @writer
tweet_id: 9876543210
article_id: 1122334455
url: https://x.com/writer/status/9876543210
article_url: https://x.com/i/article/1122334455
date: 2025-03-15 14:30:00 UTC
type: article
title: My Long-Form Post
---

# Article by @writer

## My Long-Form Post

Full article content here...
```

## Deduplication

Processed bookmark IDs are tracked in `./bookmarks/.state.json`. Running the tool again will skip already-processed bookmarks, so you can safely re-run it without creating duplicates.

**Note on ID count vs file count:** When a thread is processed, *all* tweet IDs in the thread are marked as processed (not just the bookmarked tweet). A 15-tweet thread produces 1 `.md` file but adds 15 IDs to the state file. This means the processed ID count in `.state.json` will be higher than the number of `.md` files. This is intentional -- it prevents duplicate thread files when multiple tweets from the same thread are bookmarked separately.

## Thread Detection

Uses `bird thread <id>` to fetch the full conversation thread natively. The tool filters to self-reply tweets (same author) and outputs them chronologically. The bookmarked tweet is marked with *(bookmarked)* in the output.

## Rate Limiting

Twitter's API has rate limits. When a 429 (rate limit) response is received, the tool saves progress on everything processed so far and stops gracefully. The next scheduled run (or manual run) will pick up remaining bookmarks automatically. The `bird thread` command is the most rate-limit-prone operation since it makes additional API calls per bookmark.

## License

[MIT](LICENSE)
