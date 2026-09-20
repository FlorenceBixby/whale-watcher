import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ID, SUMMARIZE, DEFAULT_THRESHOLDS, findNew, pruneSeen, meetsThreshold, money } from "../src/detect.js";

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url))).data;

test("findNew only returns rows not yet seen, newest first, capped", () => {
  const rows = fixture("flow-alerts");
  const first = findNew(rows, [], ID.flow, { max: 3 });
  assert.equal(first.fresh.length, 3);
  assert.equal(first.ids.length, rows.length);
  const second = findNew(rows, first.ids, ID.flow);
  assert.equal(second.fresh.length, 0, "a second poll over the same data must not re-alert");
});

test("ids are stable and unique per feed", () => {
  for (const [feed, name] of [["flow", "flow-alerts"], ["darkpool", "darkpool"], ["congress", "congress"], ["insider", "insiders"]]) {
    const rows = fixture(name);
    const ids = rows.map(ID[feed]);
    assert.equal(new Set(ids).size, ids.length, `${feed} ids collide`);
    assert.deepEqual(rows.map(ID[feed]), ids, `${feed} ids must be deterministic`);
  }
});

test("pruneSeen keeps the newest ids under the limit", () => {
  const ids = Array.from({ length: 700 }, (_, i) => `id${i}`);
  const pruned = pruneSeen(ids, 600);
  assert.equal(pruned.length, 600);
  assert.equal(pruned[0], "id100");
  assert.equal(pruned.at(-1), "id699");
});

test("every feed summarizes into a headline + detail with the ticker", () => {
  for (const [feed, name] of [["flow", "flow-alerts"], ["darkpool", "darkpool"], ["congress", "congress"], ["insider", "insiders"]]) {
    for (const row of fixture(name)) {
      const e = SUMMARIZE[feed](row);
      assert.equal(e.feed, feed);
      assert.ok(e.headline.includes(row.ticker), `${feed} headline missing ticker: ${e.headline}`);
      assert.ok(e.detail.length > 10);
      assert.ok(Number.isFinite(e.premium));
    }
  }
});

test("thresholds gate small events out and let big ones through", () => {
  const small = { feed: "flow", premium: 10_000 };
  const big = { feed: "flow", premium: 2_000_000 };
  assert.equal(meetsThreshold(small, DEFAULT_THRESHOLDS), false);
  assert.equal(meetsThreshold(big, DEFAULT_THRESHOLDS), true);
  assert.equal(meetsThreshold(small, { minFlowPremium: 5_000 }), true, "custom thresholds override defaults");
});

test("money formats the way a human reads it", () => {
  assert.equal(money(950), "$950");
  assert.equal(money(42_000), "$42K");
  assert.equal(money(1_250_000), "$1.3M");
  assert.equal(money(27_723_806), "$28M");
  assert.equal(money(2_400_000_000), "$2.40B");
});
