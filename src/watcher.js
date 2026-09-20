import { Agent } from "agents";
import { UWClient, UWError } from "./uw.js";
import { FEEDS, ID, SUMMARIZE, DEFAULT_THRESHOLDS, findNew, pruneSeen, meetsThreshold } from "./detect.js";
import { narrate } from "./narrate.js";
import { postAlerts } from "./discord.js";

const MAX_TICKERS = 25;
const MAX_STORED_ALERTS = 100;
const FIRST_POLL_CAP = 3;

// One WhaleWatcher per watchlist (idFromName(watchlistName)). It owns the
// tickers, the "already alerted" ids per feed, and its own polling schedule —
// so a watchlist keeps running with no request traffic at all, and two
// overlapping polls can never double-alert because the Durable Object
// serializes them.
export class WhaleWatcher extends Agent {
  initialState = {
    tickers: [],
    thresholds: { ...DEFAULT_THRESHOLDS },
    seen: Object.fromEntries(FEEDS.map(f => [f, []])),
    running: false,
    scheduleId: null,
    pollEverySeconds: 300,
    polls: 0,
    lastPollAt: null,
    lastError: null,
    alerts: [],
  };

  async getStatus() {
    const { seen, ...rest } = this.state;
    return { ...rest, name: this.name, seenCounts: Object.fromEntries(FEEDS.map(f => [f, (seen[f] || []).length])) };
  }

  async addTickers(list) {
    const clean = (list || []).map(t => String(t).trim().toUpperCase()).filter(t => /^[A-Z.]{1,6}$/.test(t));
    const tickers = [...new Set([...this.state.tickers, ...clean])].slice(0, MAX_TICKERS);
    this.setState({ ...this.state, tickers });
    return { tickers };
  }

  async removeTicker(ticker) {
    const t = String(ticker).trim().toUpperCase();
    this.setState({ ...this.state, tickers: this.state.tickers.filter(x => x !== t) });
    return { tickers: this.state.tickers };
  }

  async setThresholds(patch) {
    const thresholds = { ...this.state.thresholds };
    for (const [k, v] of Object.entries(patch || {})) {
      if (k in DEFAULT_THRESHOLDS && Number.isFinite(Number(v))) thresholds[k] = Number(v);
    }
    this.setState({ ...this.state, thresholds });
    return { thresholds };
  }

  async start(everySeconds) {
    const every = Math.max(60, Number(everySeconds) || this.state.pollEverySeconds);
    await this._cancelPolling();
    const schedule = await this.scheduleEvery(every, "poll", {});
    this.setState({ ...this.state, running: true, scheduleId: schedule.id, pollEverySeconds: every, lastError: null });
    return { running: true, pollEverySeconds: every };
  }

  async stop() {
    await this._cancelPolling();
    this.setState({ ...this.state, running: false, scheduleId: null });
    return { running: false };
  }

  async _cancelPolling() {
    if (this.state.scheduleId) {
      try { await this.cancelSchedule(this.state.scheduleId); } catch {}
    }
  }

  // Manual trigger from the UI/API — same code path as the schedule.
  async pollNow() {
    return this.poll();
  }

  // Forget everything alerted so far (tickers and thresholds stay). Mostly
  // for demos: the next poll behaves like the first one again.
  async reset() {
    this.setState({ ...this.state, seen: Object.fromEntries(FEEDS.map(f => [f, []])), alerts: [], polls: 0, lastPollAt: null, lastError: null });
    return { reset: true };
  }

  async poll() {
    const tickers = this.state.tickers;
    if (!tickers.length) return { skipped: "no tickers" };
    const uw = new UWClient(this.env);
    const firstPoll = this.state.polls === 0;
    const cap = firstPoll ? FIRST_POLL_CAP : 20;
    const seen = Object.fromEntries(FEEDS.map(f => [f, [...(this.state.seen[f] || [])]]));
    const events = [];
    const errors = [];

    const take = (feed, rows) => {
      const { fresh, ids } = findNew(rows, seen[feed], ID[feed], { max: cap });
      seen[feed] = pruneSeen([...seen[feed], ...ids]);
      for (const row of fresh) {
        const event = SUMMARIZE[feed](row);
        if (meetsThreshold(event, this.state.thresholds)) events.push(event);
      }
    };

    for (const ticker of tickers) {
      try { take("flow", await uw.flowAlerts({ ticker, minPremium: this.state.thresholds.minFlowPremium })); }
      catch (err) { errors.push(`flow ${ticker}: ${err.message}`); if (fatal(err)) return this._halt(err); }
      try { take("darkpool", await uw.darkpool(ticker, { minPremium: this.state.thresholds.minDarkpoolPremium })); }
      catch (err) { errors.push(`darkpool ${ticker}: ${err.message}`); if (fatal(err)) return this._halt(err); }
    }
    const inList = row => tickers.includes(String(row.ticker || "").toUpperCase());
    try { take("congress", (await uw.congress()).filter(inList)); }
    catch (err) { errors.push(`congress: ${err.message}`); }
    try { take("insider", (await uw.insiders()).filter(inList)); }
    catch (err) { errors.push(`insider: ${err.message}`); }

    const narrated = await narrate(this.env, events);
    const { posted } = await postAlerts(this.env, this.name, narrated);
    const stored = narrated.map(a => ({ feed: a.feed, ticker: a.ticker, text: a.text, premium: a.premium, at: a.at, detectedAt: new Date().toISOString() }));

    this.setState({
      ...this.state,
      seen,
      polls: this.state.polls + 1,
      lastPollAt: new Date().toISOString(),
      lastError: errors.length ? errors.join(" | ").slice(0, 500) : null,
      alerts: [...stored, ...this.state.alerts].slice(0, MAX_STORED_ALERTS),
    });
    return { tickers: tickers.length, events: events.length, posted, errors };
  }

  // A 401/403 means the key is gone — keep polling and we'd just burn the
  // schedule forever. Stop, record it, let the UI show it.
  async _halt(err) {
    await this._cancelPolling();
    this.setState({ ...this.state, running: false, scheduleId: null, lastError: `stopped: ${err.message}` });
    return { halted: true, error: err.message };
  }
}

function fatal(err) {
  return err instanceof UWError && (err.status === 401 || err.status === 403);
}
