import { getAgentByName } from "agents";
import { renderUI } from "./ui.js";

export { WhaleWatcher } from "./watcher.js";

const json = (data, status = 200) => Response.json(data, { status });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(renderUI(), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
    }
    if (url.pathname === "/health") return json({ ok: true, mode: env.UW_MODE || "live" });

    const m = url.pathname.match(/^\/api\/watchlists\/([a-z0-9-]{1,40})(?:\/([a-z]+))?$/i);
    if (!m) return json({ error: "not found" }, 404);
    if (!env.ADMIN_KEY || request.headers.get("X-Admin-Key") !== env.ADMIN_KEY) return json({ error: "unauthorized" }, 401);

    const [, name, action] = m;
    const watcher = await getAgentByName(env.WHALE_WATCHER, name.toLowerCase());
    let body = {};
    if (request.method === "POST") { try { body = await request.json(); } catch {} }

    try {
      if (request.method === "GET" && !action) return json(await watcher.getStatus());
      if (request.method === "POST") {
        switch (action) {
          case "tickers": {
            if (body.remove) await watcher.removeTicker(body.remove);
            if (body.add) await watcher.addTickers(Array.isArray(body.add) ? body.add : String(body.add).split(/[\s,]+/));
            return json(await watcher.getStatus());
          }
          case "thresholds": return json(await watcher.setThresholds(body));
          case "start": return json(await watcher.start(body.everySeconds));
          case "stop": return json(await watcher.stop());
          case "poll": return json(await watcher.pollNow());
          case "reset": return json(await watcher.reset());
        }
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(`[api] ${name}/${action}: ${err.stack || err}`);
      return json({ error: err.message }, 500);
    }
  },
};
