import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 650 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(
    process.env.TEST_BASE_URL ??
      "http://127.0.0.1:3219/zhiyin-guzheng-practice/",
  );
  await page.getByRole("button", { name: "练习勾托指序", exact: true }).click();
  await page.getByLabel("基础速度", { exact: true }).fill("120");
  await page.getByLabel("无琴体验 · 模拟演奏").check();
  await page.addStyleTag({
    content:
      ".score-paper{height:120px !important;max-height:120px !important}",
  });
  await page.getByRole("button", { name: "▶ 开始练习", exact: true }).click();
  await page
    .locator(".score-playhead")
    .waitFor({ state: "visible", timeout: 10000 });
  const samples = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const data = [],
          start = performance.now();
        function sample(now) {
          const head = document.querySelector(".score-playhead"),
            paper = document.querySelector(".score-paper");
          data.push({
            t: now - start,
            transform: head.getAttribute("transform"),
            opacity: Number(head.style.opacity),
            scroll: paper.scrollTop,
            window: window.scrollY,
          });
          if (now - start < 5200) requestAnimationFrame(sample);
          else resolve(data);
        }
        requestAnimationFrame(sample);
      }),
  );
  const distinct = new Set(
    samples.filter((s) => s.t < 1000).map((s) => s.transform),
  ).size;
  assert.ok(distinct >= 30, `only ${distinct} positions in one second`);
  const xy = (s) =>
    s.transform
      .match(/translate\(([^,]+),([^\)]+)\)/)
      .slice(1)
      .map(Number);
  assert.ok(
    samples.some((s) => xy(s)[1] === 180),
    "must cross to next line",
  );
  assert.ok(
    samples.every((s) => [0, 180].includes(xy(s)[1])),
    "cursor must not move diagonally between lines",
  );
  assert.ok(
    samples.some((s) => s.opacity < 0.7),
    "line transition must fade",
  );
  assert.equal(
    new Set(samples.map((s) => s.window)).size,
    1,
    "whole page must not move",
  );
  assert.ok(
    new Set(samples.map((s) => s.scroll)).size > 5,
    "line follow must interpolate scroll positions",
  );
  const steps = samples
    .slice(1)
    .map((s, i) => Math.abs(s.scroll - samples[i].scroll));
  assert.ok(
    Math.max(...steps) < 30,
    `large scroll jump: ${Math.max(...steps)}`,
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.waitForTimeout(70);
  const frozen = await page
    .locator(".score-playhead")
    .getAttribute("transform");
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator(".score-playhead").getAttribute("transform"),
    frozen,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "outputs/motion-browser-results.json",
    JSON.stringify(
      {
        distinctPositionsFirstSecond: distinct,
        maxScrollStep: Math.max(...steps),
        samples,
        errors,
      },
      null,
      2,
    ),
  );
  await page
    .locator(".numbered-sheet")
    .screenshot({ path: "outputs/smooth-score.png" });
  console.log(
    `Motion passed: ${distinct} positions/s; max scroll step ${Math.max(...steps).toFixed(1)}px; row fade, stationary page, pause freeze`,
  );
} finally {
  await browser.close();
}
