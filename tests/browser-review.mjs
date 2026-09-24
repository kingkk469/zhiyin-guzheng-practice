// Synthetic audio and mobile viewport; NOT a physical iPhone/guzheng test.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
function wav() {
  const rate = 44100,
    length = rate * 3,
    b = Buffer.alloc(44 + length * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    let x = 0;
    for (const [n, m] of [62, 66, 69].entries()) {
      const age = i / rate - (0.25 + n * 0.7);
      if (age < 0) continue;
      const p = 2 * Math.PI * 440 * 2 ** ((m - 69) / 12) * age;
      x += 0.15 * Math.exp(-6 * age) * (Math.sin(p) + 0.3 * Math.sin(2 * p));
    }
    b.writeInt16LE(
      Math.max(-32767, Math.min(32767, Math.round(x * 32767))),
      44 + i * 2,
    );
  }
  return b;
}
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--no-proxy-server"],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [],
    uploads = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() !== "GET") uploads.push(r.url());
  });
  await page.goto(
    process.env.TEST_BASE_URL ??
      "http://127.0.0.1:3219/zhiyin-guzheng-practice/",
  );
  await page
    .getByRole("button", { name: "试用新识别 · 录音复核", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.getByLabel("选择手机录音").setInputFiles({
    name: "synthetic-three-notes.wav",
    mimeType: "audio/wav",
    buffer: wav(),
  });
  await page
    .getByRole("button", { name: "开始新引擎识别", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".review-notes") ||
      /识别未完成|未能启动|无法|Cannot|not defined/.test(
        document.querySelector("[role=status]")?.textContent ?? "",
      ),
    {},
    { timeout: 90000 },
  );
  console.log(
    "Review status:",
    await page.getByRole("status").allTextContents(),
  );
  assert.ok(
    await page
      .getByRole("button", { name: "导出识别结果", exact: true })
      .count(),
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出识别结果", exact: true }).click(),
  ]);
  const result = JSON.parse(await readFile(await download.path(), "utf8"));
  for (const pitch of [62, 66, 69])
    assert.ok(
      result.notes.some((n) => n.pitchMidi === pitch),
      `missing ${pitch}`,
    );
  assert.equal(result.mode, "experimental-transcription");
  assert.equal(uploads.length, 0);
  await page.locator(".review-notes button").first().click();
  assert.ok(await dialog.locator("audio").evaluate((a) => !a.paused));
  await dialog.screenshot({ path: "outputs/review-mobile.png" });
  await page
    .getByRole("button", { name: "开始新引擎识别", exact: true })
    .click();
  await page.getByRole("button", { name: "取消处理", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已取消" }).waitFor();
  await page.getByLabel("选择手机录音").setInputFiles({
    name: "broken.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not audio"),
  });
  await page
    .getByRole("button", { name: "开始新引擎识别", exact: true })
    .click();
  await page
    .getByRole("button", { name: "开始新引擎识别", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".review-actions .primary-button")?.disabled,
  );
  assert.equal(await page.locator(".review-notes button").count(), 0);
  // Real MediaRecorder over a synthetic browser stream; no physical mic.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(),
        dest = ctx.createMediaStreamDestination(),
        osc = ctx.createOscillator(),
        gain = ctx.createGain();
      gain.gain.value = 0.05;
      osc.connect(gain).connect(dest);
      osc.start();
      window.__trialStream = dest.stream;
      window.__trialContext = ctx;
      await ctx.resume();
      return dest.stream;
    };
  });
  await page.getByRole("button", { name: "直接录一段", exact: true }).click();
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: /停止录音/ }).click();
  await page.getByText("刚录制的片段 · 最多30秒", { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector(".review-dialog audio")?.duration > 0,
  );
  assert.ok(
    await page.evaluate(() =>
      window.__trialStream.getTracks().every((t) => t.readyState === "ended"),
    ),
  );
  await page.evaluate(() => window.__trialContext.close());
  await page.getByLabel("关闭录音复核").click();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      backend: result.backend,
      notes: result.notes.length,
      pitches: result.notes.map((n) => n.pitchMidi),
      uploads: uploads.length,
      checks: "decode, inference, replay, export, cancel, corrupt input, close",
    }),
  );
} finally {
  await browser.close();
}
