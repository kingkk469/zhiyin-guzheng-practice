// Synthetic Web Audio input, NOT a physical microphone or real guzheng acceptance test.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { STRINGS } from "../lib/practice-core.ts";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } }),
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
  await page.goto(process.env.TEST_BASE_URL ?? "http://127.0.0.1:3219/");
  await page.getByRole("button", { name: "开始校音 →", exact: true }).click();
  await page.getByRole("button", { name: "逐弦精调", exact: true }).click();
  await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
  await page.getByText("环境已检查，请逐弦拨响", { exact: true }).waitFor();
  await page.evaluate(
    (notes) => window.__syntheticInput.play(notes, 1.15),
    STRINGS,
  );
  await page
    .getByRole("button", { name: "校音完成，去练习 →", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".v-string-grid .passed").length === 21,
    {},
    { timeout: 35000 },
  );
  await page
    .getByRole("button", { name: "校音完成，去练习 →", exact: true })
    .click();
  await page.getByLabel("基础速度", { exact: true }).fill("120");
  await page.getByRole("button", { name: "▶ 开始练习", exact: true }).click();
  await page.evaluate(() =>
    window.__syntheticInput.play(
      [62, 64, 66, 69, 71, 69, 66, 64, 62, 66, 64, 69, 66, 64, 62],
      0.5,
      3.94,
    ),
  );
  await page
    .getByRole("heading", { name: "每一次练习，都听见进步。" })
    .waitFor({ timeout: 20000 });
  const records = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("zhiyin-v2-records")),
    ),
    r = records[0];
  assert.equal(r.demo, false);
  assert.equal(r.completed, true);
  assert.ok(r.pitchScore >= 90, JSON.stringify(r));
  assert.ok(r.rhythmScore >= 90, JSON.stringify(r));
  assert.ok(
    (await page.locator("audio").count()) > 0,
    "recording playback exists",
  );
  assert.deepEqual(errors, []);
  await mkdir("outputs", { recursive: true });
  await writeFile(
    "outputs/synthetic-audio-results.json",
    JSON.stringify(
      { synthetic: true, realInstrumentVerified: false, report: r, errors },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: "outputs/synthetic-audio-report.png",
    fullPage: true,
  });
  console.log(
    `Synthetic browser audio: all 21 strings, pitch ${r.pitchScore}, rhythm ${r.rhythmScore}, recording available`,
  );
} finally {
  await browser.close();
}
