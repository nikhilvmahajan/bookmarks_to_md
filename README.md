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

## How It Works

The tool uses a two-phase approach to handle large bookmark collections without hitting rate limits:

### Phase 1: Listing

Crawls your bookmarks from Twitter into a local pending queue. Twitter's API returns ~20 bookmarks per page, so the tool fetches multiple pages per run (default 10 pages = ~200 bookmarks), saves a cursor, and continues from where it left off on the next run.

For example, with 2000 bookmarks:

| Run | What happens | Pending queue |
|-----|-------------|---------------|
| 1 | Fetches pages 1-10 (~200 bookmarks) | 200 |
| 2 | Fetches pages 11-20 (resumes from cursor) | ~400 |
| ... | ... | ... |
| 10 | Fetches pages 91-100, no more cursor = listing complete | ~2000 |

### Phase 2: Processing

Each run pops `batchSize` items (default 10) from the pending queue and processes them:
- Detects if the tweet is an **X article** (expands t.co shortlinks if needed)
- Detects if the tweet is part of a **thread** (via `bird thread`)
- Writes a `.md` file (standalone tweet, thread, or article)
- Saves state after each item, so rate limits or crashes lose no progress

Both phases run in the same invocation -- listing adds to the queue, processing drains it.

### Steady State

Once the initial listing is complete and the queue is empty, each run fetches the most recent page (~20 bookmarks) and checks for new ones. New bookmarks you add on Twitter are automatically picked up.

## Usage

```bash
# Run (listing + processing happens automatically)
node src/cli.js

# Skip thread detection (faster, no extra API calls per tweet)
node src/cli.js --no-threads

# Check progress
node src/cli.js status

# Reset state (re-crawl everything from scratch)
node src/cli.js reset

# View or update config
node src/cli.js config
node src/cli.js config --batch-size 20 --listing-pages 15
```

## Configuration

Settings are stored in `.bookmarks-config.json`. View or update via:

```bash
node src/cli.js config                            # show current config
node src/cli.js config --batch-size 10            # tweets to process per run
node src/cli.js config --listing-pages 10         # pages to crawl per run
node src/cli.js config --battery-threshold 15     # min battery % to proceed
node src/cli.js config --output ./my-bookmarks    # output directory
```

| Setting | Default | Description |
|---------|---------|-------------|
| `batchSize` | `5` | Number of bookmarks to process per run. |
| `listingPages` | `10` | Pages to crawl per listing run (~20 bookmarks/page). |
| `batteryThreshold` | `50` | Minimum battery % to proceed (when on battery). |
| `birdPath` | `null` | Full path to the bird binary. `null` uses PATH. |
| `outputDir` | `./bookmarks` | Directory where Markdown files are saved. |
| `authToken` | `null` | Twitter `auth_token` cookie value. |
| `ct0` | `null` | Twitter `ct0` cookie value. |

## Automatic Scheduling

The tool can run automatically on a schedule using Windows Task Scheduler.

### Install the scheduled task

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1
```

This registers a task called "Twitter Bookmarks Sync" that:

- Triggers at logon (10-minute delay), then repeats every 60 minutes
- Checks battery: skips if on battery and below threshold
- Runs one listing + processing cycle per invocation
- Logs to `logs/sync.log`

The logon delay exists so you have time to log in and refresh your session cookies before the first run fires.

### Customize the schedule

`-IntervalMinutes` sets how often the task repeats; `-StartDelayMinutes` sets the one-time delay after logon before the first run.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1 -IntervalMinutes 90 -StartDelayMinutes 5
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-IntervalMinutes` | `60` | Minutes between repeated runs. |
| `-StartDelayMinutes` | `10` | Delay after logon before the first run. |
| `-TaskName` | `Twitter Bookmarks Sync` | Name of the scheduled task. |
| `-Uninstall` | -- | Removes the task instead of registering it. |

**Note:** re-registering only changes the repetition schedule from the *next logon* onward -- Windows does not re-arm a logon trigger's repetition mid-session. After changing the interval, either reboot or kick a run manually.

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

Processed bookmark IDs are tracked in `.bookmarks-state.json`. Running the tool again will skip already-processed bookmarks, so you can safely re-run it without creating duplicates.

**Note on ID count vs file count:** When a thread is processed, *all* tweet IDs in the thread are marked as processed (not just the bookmarked tweet). A 15-tweet thread produces 1 `.md` file but adds 15 IDs to the state file. This means the processed ID count will be higher than the number of `.md` files. This is intentional -- it prevents duplicate thread files when multiple tweets from the same thread are bookmarked separately.

## Rate Limiting

Twitter's API has rate limits. When a 429 (rate limit) response is received, the tool saves progress on everything processed so far and stops gracefully. The next scheduled run (or manual run) picks up remaining bookmarks from the pending queue automatically. The `bird thread` command is the most rate-limit-prone operation since it makes additional API calls per bookmark.

## License

[MIT](LICENSE)
