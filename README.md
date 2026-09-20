# Whale Watcher

Unusual money, in plain English. One AI agent per watchlist that watches the [Unusual Whales](https://unusualwhales.com) API for the four things a retail trader can't watch all day — big options flow, dark-pool blocks, congressional trades, and insider filings — and posts a one-sentence, jargon-free alert to Discord the moment something *new* shows up.

Built for Unusual Whales Hackathon #1 on the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/).

## What it does

- **You give it tickers.** `NVDA AAPL TSLA`, up to 25 per watchlist. Any number of watchlists.
- **It polls on its own.** Each watchlist is a Durable Object that schedules its own polling (`scheduleEvery`) — no cron, no server to keep alive, it keeps running with zero traffic.
- **It only tells you what's new.** Every alert it has ever sent is remembered per feed, so a busy ticker never re-alerts the same sweep or the same Form 4.
- **It explains, it doesn't hype.** Each raw event becomes one sentence a non-professional understands (what happened, why it might matter), written by Claude, with a deterministic template as fallback — *no advice, no "consider buying"*.
- **Thresholds are yours.** Minimum options premium, minimum dark-pool block, minimum insider value — per watchlist.

Example alerts, verbatim from a run:

> NVDA puts worth $2.9M at the $180 strike were aggressively sold, suggesting sellers don't expect NVDA to fall below $180 — a bullish sign.
>
> A $69M NVDA block (400,000 shares at $172.10) traded off-exchange in a dark pool, but it was only 0.7% of the day's volume.
>
> Tim Cook (CEO) sold $1.2M of AAPL. 10,000 shares @ $118.40 — pre-scheduled 10b5-1 plan, less signal.

## Unusual Whales endpoints used

| Feed | Endpoint | Identity (for dedup) |
|---|---|---|
| Options flow | `GET /api/option-trades/flow-alerts?ticker_symbol=&min_premium=` | ticker + option chain + rule + created_at |
| Dark pool | `GET /api/darkpool/{ticker}?min_premium=` | `tracking_id` |
| Congress | `GET /api/congress/recent-trades` (filtered to the watchlist) | politician + ticker + date + side + amount |
| Insiders | `GET /api/insider/transactions?transaction_codes[]=P&S` | filing `ids` |

REST with `Authorization: Bearer <key>`. Websocket channels need the Advanced plan, so this is designed around polling on the Basic plan: 4 feeds × N tickers every 5 minutes fits comfortably under Basic's 40k requests/day.

## How it works

```
Discord  ◀──  narrate (Claude)  ◀──  detect (dedup + thresholds)  ◀──  UW REST
                                          ▲
                        WhaleWatcher Durable Object (one per watchlist)
                        state: tickers, thresholds, seen ids, last 100 alerts
                        schedule: scheduleEvery(N seconds, "poll")
```

- `src/watcher.js` — the `Agent`. State, scheduling, the `poll()` loop. Because a Durable Object serializes its calls, two overlapping polls can never double-alert.
- `src/detect.js` — pure functions: stable ids per feed, `findNew`, thresholds, and the plain-English templates. Unit-tested.
- `src/narrate.js` — Claude rewrite (numbered plain text, not JSON, so a stray quote can't break the parse), template fallback.
- `src/uw.js` — the REST client, plus a fixtures mode that serves bundled sample data so the whole thing runs with no API key.
- `src/discord.js` — one embed per feed per poll.
- `src/index.js` / `src/ui.js` — a tiny admin API and a single-page UI.

## Run it

```bash
npm install
cp .dev.vars.example .dev.vars   # set ADMIN_KEY; the rest are optional
npm run dev                      # http://localhost:8788 — fixtures mode, no key needed
npm test
```

Then in the UI: admin key → watchlist name → add tickers → **Poll now**. **Start polling** hands the loop to the Durable Object.

Live data: set `UW_MODE = "live"` in `wrangler.toml` and add `UW_API_KEY` (and `DISCORD_WEBHOOK_URL`, `ANTHROPIC_API_KEY`) as secrets:

```bash
npx wrangler secret put UW_API_KEY
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_KEY
npm run deploy
```

## API

All routes need `X-Admin-Key`.

```
GET  /api/watchlists/:name                 status + recent alerts
POST /api/watchlists/:name/tickers         {"add":"NVDA AAPL"} | {"remove":"AAPL"}
POST /api/watchlists/:name/thresholds      {"minFlowPremium":500000, ...}
POST /api/watchlists/:name/start           {"everySeconds":300}
POST /api/watchlists/:name/stop
POST /api/watchlists/:name/poll            run one poll now
POST /api/watchlists/:name/reset           forget what's been alerted (demo)
```

## Not advice

Whale Watcher reports what the data says happened. It does not know what will happen next and neither does anyone else.
