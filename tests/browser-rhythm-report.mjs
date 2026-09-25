// Synthetic report fixture; no user recording or annotation is sent to the browser/site.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { PracticeEngine, makeTimeline } from "../lib/practice-core.ts";
import { SCORES } from "../lib/scores.ts";
const score = SCORES.find((s) => s.id === "daily-rhythm-2");
const t = makeTimeline(score, 70);
const engine = new PracticeEngine(t, {
  pitchCents: 50,
  timingFraction: 0.22,
  minimumTimingMs: 110,
  latencyMs: 0,
});
const notes = t.events.filter((n) => n.midi !== null);
notes.forEach((n, i) =>
  engine.consume({
    at: n.time + (i % 8 === 5 ? -0.16 : 0.1),
    midi: n.midi,
    confidence: 0.99,
  }),
);
const report = engine.report(score, true);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const width of [390, 1365]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      (r) => localStorage.setItem("zhiyin-v2-records", JSON.stringify([r])),
      report,
    );
    await page.goto(
      process.env.TEST_BASE_URL ??
        "http://127.0.0.1:3223/zhiyin-guzheng-practice/",
    );
    await page.getByRole("button", { name: "练习记录", exact: true }).click();
    await page.getByRole("button", { name: "查看", exact: true }).click();
    const details = page
      .locator("details")
      .filter({ has: page.getByText("逐音节奏问题", { exact: true }) });
    assert.equal(await details.locator("li").count(), 4);
    for (const index of [6, 14, 22, 30])
      assert.match(await details.innerText(), new RegExp(`第 ${index} 个音`));
    assert.match(await details.innerText(), /音高正确；提前 160 毫秒/);
    assert.match(await details.innerText(), /长短节奏接近均分/);
    assert.equal(
      await page.locator('.score-symbol[fill="#a46412"]').count(),
      4,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, "mobile layout must fit viewport");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出报告 ↓", exact: true }).click();
    const download = await downloadPromise;
    const chunks = [];
    for await (const chunk of await download.createReadStream())
      chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks));
    assert.equal(exported.ruleVersion, "0.10.0-score-rhythm-trial");
    assert.equal(
      exported.evaluations.filter((e) => e.timing?.pattern).length,
      4,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Mobile/desktop rhythm report, orange score marks and full evidence export passed",
  );
} finally {
  await browser.close();
}
