import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("outputs", { recursive: true });
try {
  await page.goto("http://127.0.0.1:3219/");
  await page.getByRole("heading", { name: /每一个音/ }).waitFor();
  assert.equal(await page.locator(".v-card").count(), 10);
  await page.screenshot({ path: "outputs/home-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "练习勾托指序", exact: true }).click();
  await page.getByRole("button", { name: "▶ 开始练习", exact: true }).click();
  await page.getByRole("heading", { name: /让每一根弦/ }).waitFor();
  assert.equal(await page.locator(".v-sweep-note").count(), 21);
  assert.equal(
    await page.getByRole("button", { name: /校音完成，去练习/ }).isDisabled(),
    true,
  );
  await page.screenshot({ path: "outputs/tuning.png", fullPage: true });
  await page.getByRole("button", { name: "返回练习首页" }).click();
  await page.getByRole("button", { name: "练习勾托指序", exact: true }).click();
  await page.getByLabel("基础速度", { exact: true }).fill("120");
  await page.getByLabel("无琴体验 · 模拟演奏").check();
  await page.getByRole("button", { name: "▶ 开始练习", exact: true }).click();
  await page.getByText("专注眼前这一句。", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("基础速度", { exact: true }).isDisabled(),
    true,
  );
  await page.waitForTimeout(5300);
  await page.screenshot({ path: "outputs/practice.png", fullPage: true });
  await page
    .getByRole("heading", { name: "每一次练习，都听见进步。" })
    .waitFor({ timeout: 20000 });
  assert.equal(
    (await page.locator(".v-total strong").innerText()) === "—",
    false,
  );
  await page.screenshot({ path: "outputs/report.png", fullPage: true });
  await page.getByRole("button", { name: "练习记录", exact: true }).click();
  assert.equal(await page.locator(".v-history article").count(), 1);
  await page.reload();
  await page.getByRole("button", { name: "练习记录", exact: true }).click();
  await page.locator(".v-history article").waitFor();
  await page.getByRole("button", { name: "查看", exact: true }).click();
  await page
    .getByRole("heading", { name: "每一次练习，都听见进步。" })
    .waitFor();
  await page.getByRole("button", { name: "再练一次", exact: true }).click();
  await page.getByLabel("无琴体验 · 模拟演奏").check();
  await page.getByRole("button", { name: "▶ 开始练习", exact: true }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "结束并查看", exact: true }).click();
  await page.getByText("未完整完成本次范围", { exact: true }).waitFor();
  assert.equal(await page.locator(".v-total strong").innerText(), "—");
  await page.getByRole("button", { name: "曲谱管理", exact: true }).click();
  await page.getByLabel("曲谱JSON").fill('{"id":"bad"}');
  await page.getByRole("button", { name: "校验并导入", exact: true }).click();
  await page.locator('ul[role="alert"]').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "返回练习首页" }).click();
  await page.screenshot({ path: "outputs/home-mobile.png", fullPage: true });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile horizontal overflow",
  );
  await page.getByRole("button", { name: "练习清溪引", exact: true }).click();
  await page.screenshot({ path: "outputs/score-mobile.png", fullPage: true });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "score horizontal overflow",
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({
    path: "outputs/score-landscape.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    "outputs/browser-results.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "home 10 units",
          "21-string gate",
          "demo complete and score",
          "disabled speed while active",
          "record persistence",
          "incomplete has no total",
          "invalid import rejected",
          "mobile overflow",
          "landscape layout",
          "no page errors",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Browser smoke: 10 checks passed; screenshots in outputs/");
} finally {
  await browser.close();
}
