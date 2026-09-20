import flowFixture from "../fixtures/flow-alerts.json" with { type: "json" };
import darkpoolFixture from "../fixtures/darkpool.json" with { type: "json" };
import congressFixture from "../fixtures/congress.json" with { type: "json" };
import insidersFixture from "../fixtures/insiders.json" with { type: "json" };

const BASE = "https://api.unusualwhales.com";

export class UWError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Thin REST client for the four feeds Whale Watcher polls. Basic-plan keys are
// REST-only (websocket channels need the Advanced plan), so polling it is.
export class UWClient {
  constructor(env) {
    this.key = env.UW_API_KEY;
    this.fixtures = env.UW_MODE === "fixtures" || !this.key;
  }

  async get(path, params = {}) {
    if (this.fixtures) return fixtureFor(path, params);
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v.forEach(x => url.searchParams.append(k, String(x)));
      else url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json, text/plain" },
    });
    if (!res.ok) throw new UWError(`UW ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`, res.status);
    const body = await res.json();
    return Array.isArray(body) ? body : body.data || [];
  }

  flowAlerts({ ticker, minPremium, limit = 50, newerThan } = {}) {
    return this.get("/api/option-trades/flow-alerts", {
      ticker_symbol: ticker, min_premium: minPremium, limit, newer_than: newerThan,
    });
  }

  darkpool(ticker, { minPremium, limit = 50, newerThan } = {}) {
    return this.get(`/api/darkpool/${encodeURIComponent(ticker)}`, {
      min_premium: minPremium, limit, newer_than: newerThan, order: "desc", order_by: "executed_at",
    });
  }

  congress({ limit = 100 } = {}) {
    return this.get("/api/congress/recent-trades", { limit });
  }

  insiders({ limit = 200 } = {}) {
    return this.get("/api/insider/transactions", { limit, "transaction_codes[]": ["P", "S"], common_stock_only: true });
  }
}

function fixtureFor(path, params) {
  if (path.startsWith("/api/option-trades/flow-alerts")) {
    return flowFixture.data.filter(r => !params.ticker_symbol || r.ticker === params.ticker_symbol);
  }
  if (path.startsWith("/api/darkpool/")) {
    const ticker = decodeURIComponent(path.split("/").pop());
    return darkpoolFixture.data.filter(r => r.ticker === ticker);
  }
  if (path.startsWith("/api/congress/")) return congressFixture.data;
  if (path.startsWith("/api/insider/")) return insidersFixture.data;
  return [];
}
