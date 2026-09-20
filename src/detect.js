// Pure functions: identity, dedup, thresholds, and plain-English fallback text
// for each feed. No I/O here so it's unit-testable with plain node.

export const FEEDS = ["flow", "darkpool", "congress", "insider"];

export const DEFAULT_THRESHOLDS = {
  minFlowPremium: 250_000,
  minDarkpoolPremium: 5_000_000,
  minInsiderValue: 250_000,
  congressMinAmount: 15_001,
};

export const ID = {
  flow: a => [a.ticker, a.option_chain, a.alert_rule, a.created_at].join("|"),
  darkpool: t => String(t.tracking_id),
  congress: t => [t.politician_id || t.reporter, t.ticker, t.transaction_date, t.txn_type, t.amounts].join("|"),
  insider: t => (t.ids && t.ids.length ? `ids:${t.ids.join(",")}` : [t.owner_name, t.ticker, t.transaction_date, t.transaction_code, t.amount].join("|")),
};

// Rows the watcher hasn't alerted on yet, newest first, capped. `seen` is the
// list of ids from prior polls; the caller merges `ids` back into it.
export function findNew(rows, seen, idFn, { max = 20 } = {}) {
  const seenSet = new Set(seen || []);
  const ids = [];
  const fresh = [];
  for (const row of rows || []) {
    const id = idFn(row);
    ids.push(id);
    if (!seenSet.has(id)) fresh.push(row);
  }
  return { fresh: fresh.slice(0, max), ids };
}

export function pruneSeen(ids, limit = 600) {
  const uniq = [...new Set(ids)];
  return uniq.length > limit ? uniq.slice(uniq.length - limit) : uniq;
}

const num = v => (v === null || v === undefined || v === "" ? 0 : Number(v));

export function money(n) {
  n = num(n);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

function congressLow(amounts) {
  const m = String(amounts || "").replace(/,/g, "").match(/\$?(\d+)/);
  return m ? Number(m[1]) : 0;
}

export function summarizeFlow(a) {
  const prem = num(a.total_premium);
  const ask = num(a.total_ask_side_prem), bid = num(a.total_bid_side_prem);
  const side = ask > bid * 1.5 ? "ask-side (aggressive buyer)" : bid > ask * 1.5 ? "bid-side (likely seller)" : "mixed";
  const lean = a.type === "call" ? (ask > bid ? "bullish" : "bearish/hedging") : (ask > bid ? "bearish" : "bullish/put-selling");
  const dte = a.expiry ? Math.max(0, Math.round((Date.parse(a.expiry) - Date.now()) / 86400000)) : null;
  const flags = [a.has_sweep && "sweep", a.all_opening_trades && "all opening", a.has_floor && "floor", num(a.volume_oi_ratio) >= 2 && `vol/OI ${num(a.volume_oi_ratio).toFixed(1)}x`].filter(Boolean);
  return {
    feed: "flow", ticker: a.ticker, premium: prem, lean, at: a.created_at,
    headline: `${a.ticker} ${a.type.toUpperCase()}S: ${money(prem)} at $${a.strike} strike, ${a.expiry}${dte !== null ? ` (${dte} DTE)` : ""}`,
    detail: `${a.alert_rule} — ${a.trade_count || "?"} trades, ${a.total_size || "?"} contracts, ${side}${flags.length ? ", " + flags.join(", ") : ""}. Reads ${lean}.`,
    raw: a,
  };
}

export function summarizeDarkpool(t) {
  const prem = num(t.premium);
  const pctVol = t.volume ? (num(t.size) / num(t.volume)) * 100 : null;
  return {
    feed: "darkpool", ticker: t.ticker, premium: prem, at: t.executed_at,
    headline: `${t.ticker} dark pool print: ${money(prem)} (${Number(t.size).toLocaleString()} shares @ $${num(t.price).toFixed(2)})`,
    detail: pctVol !== null ? `${pctVol.toFixed(1)}% of today's volume in one off-exchange block.` : "Off-exchange block trade.",
    raw: t,
  };
}

export function summarizeCongress(t) {
  const who = t.name || t.reporter;
  const chamber = t.member_type === "senate" ? "Sen." : t.member_type === "house" ? "Rep." : "";
  const verb = /purch|buy/i.test(t.txn_type) ? "bought" : /sell|sale/i.test(t.txn_type) ? "sold" : t.txn_type;
  const lag = t.filed_at_date && t.transaction_date ? Math.round((Date.parse(t.filed_at_date) - Date.parse(t.transaction_date)) / 86400000) : null;
  return {
    feed: "congress", ticker: t.ticker, premium: congressLow(t.amounts), at: t.filed_at_date,
    headline: `${chamber} ${who} ${verb} ${t.ticker}: ${t.amounts}`,
    detail: `Traded ${t.transaction_date}, disclosed ${t.filed_at_date}${lag !== null ? ` (${lag}-day lag)` : ""}${t.issuer && t.issuer !== "self" ? `, via ${t.issuer}` : ""}.`,
    raw: t,
  };
}

export function summarizeInsider(t) {
  const value = num(t.amount) * num(t.price);
  const role = [t.officer_title, t.is_director && "Director", t.is_ten_percent_owner && "10% owner"].filter(Boolean).join(", ") || "insider";
  const verb = t.transaction_code === "P" ? "bought" : t.transaction_code === "S" ? "sold" : `code ${t.transaction_code}`;
  return {
    feed: "insider", ticker: t.ticker, premium: value, at: t.filing_date,
    headline: `${t.owner_name} (${role}) ${verb} ${money(value)} of ${t.ticker}`,
    detail: `${Number(t.amount).toLocaleString()} shares @ $${num(t.price).toFixed(2)} on ${t.transaction_date}${t.is_10b5_1 ? " — pre-scheduled 10b5-1 plan, less signal" : t.transaction_code === "P" ? " — open-market buy, the rarer and more telling direction" : ""}.`,
    raw: t,
  };
}

export const SUMMARIZE = { flow: summarizeFlow, darkpool: summarizeDarkpool, congress: summarizeCongress, insider: summarizeInsider };

export function meetsThreshold(event, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  switch (event.feed) {
    case "flow": return event.premium >= t.minFlowPremium;
    case "darkpool": return event.premium >= t.minDarkpoolPremium;
    case "insider": return event.premium >= t.minInsiderValue;
    case "congress": return event.premium >= t.congressMinAmount;
    default: return true;
  }
}
