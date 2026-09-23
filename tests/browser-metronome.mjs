// Synthetic Web Audio input, NOT a physical microphone or real guzheng acceptance test.
import { chromium } from "playwright";
import assert from "node:assert/strict";


const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__clicks = [];
  const originalSet = AudioParam.prototype.setValueAtTime;
  AudioParam.prototype.setValueAtTime = function(value, at) { this.__scheduledValue = value; return originalSet.call(this, value, at); };
  const originalStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function(at) {
    if (this.frequency.__scheduledValue >= 800) window.__clicks.push({at, frequency: this.frequency.__scheduledValue});
    return originalStart.call(this, at);
  };
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
  for (const tone of ['wood','soft','digital']) {
    await page.goto(process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3219/zhiyin-guzheng-practice/');
    await page.getByRole('button',{name:'开始校音 →',exact:true}).click();
    await page.getByRole('button',{name:'直接去练习 →',exact:true}).click();
    await page.getByLabel('节拍音色').selectOption(tone);
    await page.getByLabel('基础速度',{exact:true}).fill('120');
    await page.getByRole('button',{name:'▶ 开始练习',exact:true}).click();
    await page.waitForFunction(() => window.__clicks.length >= 6);
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    const count = await page.evaluate(() => window.__clicks.length);
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.__clicks.length),count,'pause cancels scheduling');
  }
  assert.deepEqual(errors, []);
  console.log('All three metronome tones continue after count-in and stop on pause');
} finally { await browser.close(); }
