// Turns a batch of detected events into one plain-English line each. Claude
// when a key is present; the templated headline/detail otherwise, so the
// pipeline never depends on the model being up.

const MODEL = "claude-sonnet-5";

export async function narrate(env, events) {
  if (!events.length) return [];
  if (!env.ANTHROPIC_API_KEY) return events.map(fallback);
  try {
    const lines = await narrateWithClaude(env, events);
    return events.map((e, i) => ({ ...e, text: lines[i] || fallback(e).text }));
  } catch (err) {
    console.error(`[narrate] falling back to templates: ${err.message}`);
    return events.map(fallback);
  }
}

function fallback(e) {
  return { ...e, text: `${e.headline}. ${e.detail}` };
}

async function narrateWithClaude(env, events) {
  const payload = events.map((e, i) => ({
    n: i + 1, feed: e.feed, ticker: e.ticker, headline: e.headline, detail: e.detail,
  }));
  const prompt = `You write alerts for Whale Watcher, a bot that tells a retail trader when unusual money moves in a stock they follow. For each item below, write ONE sentence (max 30 words) in plain English a non-professional would understand: what happened, and why it might matter — no hype, no advice, no "consider buying", no emojis. Keep the ticker and the dollar figure. If the detail says a 10b5-1 plan, say it's pre-scheduled and weak signal.

Items:
${JSON.stringify(payload)}

Respond with exactly ${events.length} lines and nothing else. Each line starts with the item number, a period, and a space — e.g. "3. NVDA ...". No blank lines, no preamble, no markdown.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      // Extended thinking shares this budget; a small cap leaves no room for the text block.
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === "text");
  if (!textBlock) throw new Error("no text block in response");
  // Numbered plain text instead of JSON: a stray quote in a sentence can't
  // break the parse, and a missing line just falls back to the template.
  const lines = [];
  for (const raw of textBlock.text.split("\n")) {
    const m = raw.trim().match(/^(\d+)[.)]\s+(.+)$/);
    if (m) lines[Number(m[1]) - 1] = m[2].trim();
  }
  if (!lines.some(Boolean)) throw new Error(`no numbered lines in response: ${textBlock.text.slice(0, 120)}`);
  return lines;
}
