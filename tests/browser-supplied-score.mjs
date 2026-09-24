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
 await page.goto(process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3219/zhiyin-guzheng-practice/');
 await page.getByRole('button',{name:'练习日常节奏小练习2',exact:true}).click();
 assert.equal(await page.getByLabel('基础速度',{exact:true}).inputValue(),'70');
 assert.equal(await page.locator('.score-measure').count(),10);
 assert.equal(await page.locator('.score-symbol').count(),38);
 await page.locator('.numbered-sheet').screenshot({path:'outputs/daily-rhythm-2.png'});
 await page.getByLabel('无琴体验 · 模拟演奏').check();
 await page.getByRole('button',{name:'▶ 开始练习',exact:true}).click();
 await page.waitForFunction(()=>window.__clicks.length>=6);
 await page.locator('.numbered-sheet').screenshot({path:'outputs/daily-rhythm-2-playing.png'});
 await page.getByRole('heading',{name:'每一次练习，都听见进步。'}).waitFor({timeout:25000});
 const clicks = await page.evaluate(()=>window.__clicks);
 assert.equal(clicks.length,22,'2 count-in beats and 20 score beats including the opening rest');
 assert.ok(Math.abs(clicks[2].at-clicks[0].at-120/70)<.01);
 assert.deepEqual(errors,[]);
 console.log('Supplied score: 10 bars, 38 symbols, 70 BPM, 22 audible beats, complete playback');
} finally { await browser.close(); }
