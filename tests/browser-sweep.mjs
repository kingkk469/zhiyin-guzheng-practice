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
          if (m === null) return;
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
  await page.goto("http://127.0.0.1:3219/");
  await page.getByRole("button", { name: "开始校音 →", exact: true }).click();
  await page.locator(".v-sweep-note").first().waitFor();
  assert.equal(await page.locator(".v-sweep-note").count(), 21);
  assert.equal(
    await page
      .getByRole("button", { name: "开始顺弦巡检", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
  await page.getByText("环境已检查，请逐弦拨响", { exact: true }).waitFor();
  await page.getByRole("button", { name: "开始顺弦巡检", exact: true }).click();
  const notes = [...STRINGS];
  notes[3] += 0.32;
  notes[9] -= 0.28;
  notes[5] = null;
  await page.evaluate(
    (notes) => window.__syntheticInput.play(notes, 1.25, 4.96),
    notes,
  );
  assert.equal(
    await page.getByLabel("巡检速度", { exact: true }).isDisabled(),
    true,
  );
  await page.waitForTimeout(7500);
  await mkdir("outputs", { recursive: true });
  await page.screenshot({
    path: "outputs/tuning-sweep-live.png",
    fullPage: true,
  });
  await page.getByText("巡检完成", { exact: true }).waitFor({ timeout: 35000 });
  assert.equal(await page.locator(".v-sweep-note.correct").count(), 18);
  assert.equal(await page.locator(".v-sweep-note.high").count(), 1);
  assert.equal(await page.locator(".v-sweep-note.low").count(), 1);
  assert.equal(await page.locator(".v-sweep-note.missed").count(), 1);
  assert.equal(
    await page
      .getByRole("button", { name: "校音完成，去练习 →", exact: true })
      .isDisabled(),
    true,
  );
  await page.screenshot({
    path: "outputs/tuning-sweep-results.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "第4弦 · ↑ 偏高", exact: true })
    .click();
  await page.evaluate(
    (notes) => window.__syntheticInput.play(notes, 1.15),
    [STRINGS[3], STRINGS[5], STRINGS[9]],
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".v-string-grid .passed").length === 21,
    {},
    { timeout: 8000 },
  );
  assert.equal(
    await page
      .getByRole("button", { name: "校音完成，去练习 →", exact: true })
      .isDisabled(),
    false,
  );
  await page.getByRole("button", { name: "顺弦巡检", exact: true }).click();
  assert.equal(await page.locator(".v-sweep-note.correct").count(), 21);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "outputs/tuning-sweep-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("button", { name: "重新巡检", exact: true }).click();
  assert.equal(await page.locator(".v-sweep-note.correct").count(), 0);
  await page.getByRole("button", { name: "停止巡检", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "校音完成，去练习 →", exact: true })
      .isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "outputs/sweep-browser-results.json",
    JSON.stringify(
      {
        passed: true,
        synthetic: true,
        checks: [
          "default 21-note sheet",
          "mic gate",
          "running speed lock",
          "18 correct 1 high 1 low 1 skipped",
          "no slot shift",
          "problem string fine tuning",
          "21 confirmed gate",
          "mobile layout",
          "restart clears previous passes",
          "stop preserves unresolved status",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Sweep browser: mixed synthetic scan + fine correction + restart + mobile passed",
  );
} finally {
  await browser.close();
}
