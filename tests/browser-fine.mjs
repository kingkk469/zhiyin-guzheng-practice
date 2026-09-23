// Synthetic Web Audio input, NOT a physical microphone or real guzheng acceptance test.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile MicroMessenger/8",
  }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext(),
      dest = context.createMediaStreamDestination();
    await context.resume();
    window.__syntheticInput = {
      context,
      play(notes, spacing, delay = 0.1) {
        const start = context.currentTime + delay;
        notes.forEach((m, i) => {
          const osc = context.createOscillator(),
            amp = context.createGain(),
            at = start + i * spacing;
          osc.frequency.value = 440 * 2 ** ((m - 69) / 12);
          amp.gain.setValueAtTime(0.00001, at);
          amp.gain.exponentialRampToValueAtTime(0.25, at + 0.008);
          amp.gain.setValueAtTime(0.25, at + spacing * 0.7);
          amp.gain.exponentialRampToValueAtTime(0.00001, at + spacing * 0.9);
          osc.connect(amp).connect(dest);
          osc.start(at);
          osc.stop(at + spacing * 0.95);
        });
      },
    };
    return dest.stream;
  };
});
try {
  await page.goto(
    process.env.TEST_BASE_URL ??
      "http://127.0.0.1:3219/zhiyin-guzheng-practice/",
  );
  await page.getByRole("note").filter({ hasText: "微信内置浏览器" }).waitFor();
  await page.getByRole("button", { name: "开始校音 →", exact: true }).click();
  await page.getByRole("button", { name: "逐弦精调", exact: true }).click();
  await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
  await page.getByText("环境已检查，请逐弦拨响", { exact: true }).waitFor();
  await page.evaluate(() => window.__syntheticInput.play([86], 3));
  await page.waitForFunction(() =>
    document
      .querySelector(".v-string-grid button")
      .classList.contains("passed"),
  );
  await page.waitForTimeout(200);
  assert.equal(
    await page
      .locator(".v-string-grid button.selected")
      .evaluate((el) => Array.from(el.parentElement.children).indexOf(el)),
    0,
  );
  assert.ok(
    (await page.locator(".v-tuner").innerText()).includes("本弦已确认准确"),
  );
  await page.getByRole("button", { name: "下一根弦 →", exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator(".v-tuner .v-cents > i").count(),
    0,
    "previous string tail must not peg needle high",
  );
  assert.ok(
    (await page.locator(".v-tuner").innerText()).includes("请重新拨响当前弦"),
  );
  await page.waitForTimeout(2400);
  await page.evaluate(() => window.__syntheticInput.play([83.35], 1.3));
  await page.waitForTimeout(650);
  assert.match(await page.locator(".v-tuner").innerText(), /高了 3[456] 音分/);
  assert.equal(
    await page.locator(".v-string-grid button").nth(1).getAttribute("class"),
    "selected ",
  );
  await page.getByText("与 Tuner Lite 对照读数", { exact: true }).click();
  await page.getByRole("button", { name: "记录当前稳定读数", exact: true }).click();
  await page.getByLabel("另一款调音器的实际频率（Hz）").fill(String(440 * 2 ** ((83 - 69) / 12)));
  assert.match(await page.locator(".tuner-comparison [role=status]").innerText(), /相差 \+3[456]\./);
  await page.getByLabel("另一款调音器的实际频率（Hz）").fill("0");
  assert.equal(await page.locator(".tuner-comparison [role=status]").count(), 0);
  await page.getByRole("button", { name: "清除对照", exact: true }).click();
  assert.equal(await page.getByLabel("另一款调音器的实际频率（Hz）").count(), 0);
  await page.screenshot({
    path: "outputs/fine-tuning-fixed.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Fine tuning passed: WeChat hint, target held, stale tail ignored, actual +35 cents preserved",
  );
} finally {
  await browser.close();
}
