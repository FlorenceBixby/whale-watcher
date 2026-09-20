const COLORS = { flow: 0x5865f2, darkpool: 0x2b2d31, congress: 0xe67e22, insider: 0x57f287 };
const LABELS = { flow: "Options flow", darkpool: "Dark pool", congress: "Congress", insider: "Insider" };

// One embed per feed per poll, so a busy poll is a few tidy cards rather than
// twenty pings. Best-effort: a Discord failure logs and never breaks the poll.
export async function postAlerts(env, watchlistName, alerts) {
  if (!env.DISCORD_WEBHOOK_URL || !alerts.length) return { posted: 0 };
  const byFeed = new Map();
  for (const a of alerts) {
    if (!byFeed.has(a.feed)) byFeed.set(a.feed, []);
    byFeed.get(a.feed).push(a);
  }
  const embeds = [...byFeed.entries()].map(([feed, items]) => ({
    title: `${LABELS[feed]} — ${[...new Set(items.map(i => i.ticker))].join(", ")}`,
    color: COLORS[feed],
    description: items.slice(0, 10).map(i => `• ${i.text}`).join("\n").slice(0, 4000),
    footer: { text: `Whale Watcher · ${watchlistName} · data: Unusual Whales` },
    timestamp: new Date().toISOString(),
  }));
  try {
    const res = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Whale Watcher", embeds: embeds.slice(0, 10) }),
    });
    if (!res.ok) console.error(`[discord] ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { posted: res.ok ? alerts.length : 0 };
  } catch (err) {
    console.error(`[discord] ${err.message}`);
    return { posted: 0 };
  }
}
