// Synthetic Web Audio input, NOT a physical microphone or real guzheng acceptance test.
import { chromium } from "playwright";
import assert from "node:assert/strict";


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
  await page.goto(
    process.env.TEST_BASE_URL ??
      "http://127.0.0.1:3219/zhiyin-guzheng-practice/",
  );
  await page.getByRole("button", { name: "开始校音 →", exact: true }).click();
  await page.getByRole("button", { name: "逐弦精调", exact: true }).click();
  await page.getByRole("button", { name: "直接去练习 →", exact: true }).click();
  await page.getByLabel("基础速度", { exact: true }).fill("120");
  await page.getByRole("button", { name: "▶ 开始练习", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".v-live")?.textContent.includes("预备拍"),
  );
  await page.evaluate(() =>
    window.__syntheticInput.play(
      [62, 64, 66, 69, 71, 69, 66, 64, 62, 66, 64, 69, 66, 64, 62].map(n => n + 0.6),
      0.5,
      3.94,
    ),
  );
  const hint = page.getByRole('note').filter({hasText:'可能是琴弦音不准'});
  await hint.waitFor({timeout:15000});
  assert.match(await page.locator('.v-live').innerText(), /正在听/);
  await page.getByRole('button', {name:'去校音（结束并保留本段） →'}).click();
  await page.locator('.v-tuner').waitFor();
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('zhiyin-v2-records')));
  assert.equal(records[0].completed, false);
  assert.equal(records[0].demo, false);
  assert.deepEqual(errors, []);
  console.log('Repeated pitch deviation hint and return to tuning passed; partial record preserved');
} finally {
  await browser.close();
}
