// Real Web Audio output graph in desktop Edge with phone viewport; no real microphone.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { makeTimeline } from "../lib/practice-core.ts";
import { SCORES } from "../lib/scores.ts";
const s = structuredClone(SCORES[0]);
Object.assign(s, {
  id: "playback-import",
  title: "导入带练核对",
  startBpm: 120,
  minBpm: 20,
  maxBpm: 240,
  meter: [2, 4],
  order: [0, 1, 0],
  tempo: [
    { beat: 0, ratio: 1, ramp: true },
    { beat: 4, ratio: 1.5, ramp: false },
  ],
});
const note = (id, midi, beat, duration) => ({ id, midi, beat, duration });
s.bars = [
  {
    id: "a",
    label: "休止",
    notes: [
      note("r", null, 0, 0.5),
      note("d", 62, 0.5, 0.5),
      note("a4", 69, 1, 1),
    ],
  },
  {
    id: "b",
    label: "附点",
    notes: [
      note("d5", 74, 0, 0.75),
      note("d4", 62, 0.75, 0.25),
      note("rest", null, 1, 1),
    ],
  },
];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const uploads = [];
page.on("request", (r) => {
  if (["POST", "PUT"].includes(r.method())) uploads.push(r.url());
});
await page.addInitScript(() => {
  window.__micCalls = 0;
  window.__starts = [];
  window.__outputs = [];
  navigator.mediaDevices.getUserMedia = async () => {
    window.__micCalls++;
    throw new DOMException("denied", "NotAllowedError");
  };
  const native = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function (...args) {
    const source = native.apply(this, args),
      start = source.start;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Retain the actual AudioContext for the instrumented source callback.
    const ctx = this;
    source.start = function (...args) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      window.__outputs.push(analyser);
      const data = source.buffer.getChannelData(0);
      window.__starts.push({
        when: args[0],
        offset: args[1] ?? 0,
        length: args[2],
        rate: source.playbackRate.value,
        signature: Array.from(data.slice(100, 110)),
      });
      return start.apply(this, args);
    };
    return source;
  };
});
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3219/";
const currentTime = async () =>
  Number((await page.locator(".v-live small").innerText()).split(" / ")[0]);
const setSpeed = async (n) => {
  await page.getByLabel("基础速度", { exact: true }).fill(String(n));
  await page.getByLabel("基础速度", { exact: true }).press("Tab");
};
await mkdir("outputs", { recursive: true });
try {
  await page.goto(base);
  await page.getByRole("button", { name: "曲谱管理", exact: true }).click();
  await page.getByLabel("曲谱JSON").fill("{}");
  await page.getByRole("button", { name: "校验并导入" }).click();
  await page.locator(".v-import ul[role=alert]").waitFor();
  await page.getByLabel("曲谱JSON").fill(JSON.stringify(s));
  await page.getByRole("button", { name: "校验并导入" }).click();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  assert.equal(await page.locator("[data-note]").count(), 9);
  assert.ok(!(await page.locator("body").innerText()).includes("节奏准确"));
  await page.getByRole("button", { name: "▶ 开始带练", exact: true }).click();
  await page.waitForFunction(() => window.__starts.length >= 1);
  await page.waitForTimeout(120);
  const rms = await page.evaluate(() => {
    let peak = 0;
    for (const a of window.__outputs) {
      const d = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(d);
      peak = Math.max(
        peak,
        Math.sqrt(d.reduce((sum, v) => sum + v * v, 0) / d.length),
      );
    }
    return peak;
  });
  assert.ok(rms > 0.001, `actual audio graph RMS=${rms}`);
  await page.waitForFunction(() =>
    document.querySelector(".v-live")?.textContent.includes("带练完成"),
  );
  const starts = await page.evaluate(() => window.__starts);
  const expected = makeTimeline(s, 120).events.filter((n) => n.midi !== null);
  assert.equal(starts.length, expected.length);
  for (let i = 1; i < starts.length; i++)
    assert.ok(
      Math.abs(
        starts[i].when - starts[0].when - (expected[i].time - expected[0].time),
      ) < 0.035,
    );
  assert.ok(starts.every((n) => n.rate === 1 && n.offset === 0));
  assert.deepEqual(starts[0].signature, starts[2 + 2].signature); // Written repeat plays same D4 voice.
  await setSpeed(60);
  await page.getByRole("button", { name: "重新播放", exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const paused = await currentTime(),
    transform = await page.locator(".score-playhead").getAttribute("transform");
  await page.waitForTimeout(350);
  assert.equal(await currentTime(), paused);
  assert.equal(
    await page.locator(".score-playhead").getAttribute("transform"),
    transform,
  );
  await setSpeed(120);
  assert.ok(Math.abs((await currentTime()) - paused / 2) < 0.11);
  await page.getByRole("button", { name: "继续播放", exact: true }).click();
  await page.waitForTimeout(350);
  assert.ok((await currentTime()) > paused / 2 + 0.15);
  await page.getByLabel("速度滑块").fill("180");
  await page.waitForTimeout(100);
  assert.equal(
    await page.getByLabel("基础速度", { exact: true }).inputValue(),
    "180",
  );
  assert.ok(
    (await page.evaluate(() => window.__starts)).every((n) => n.rate === 1),
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByLabel("起始小节").selectOption("2");
  await page.getByLabel("结束小节").selectOption("2");
  await page.getByRole("button", { name: "▶ 开始带练", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".v-live")?.textContent.includes("带练完成"),
  );
  assert.equal(await page.evaluate(() => window.__micCalls), 0);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "outputs/accompaniment-phone.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "练习记录", exact: true }).click();
  assert.ok((await page.locator(".v-history article").count()) >= 2);
  await page.reload();
  await page.getByRole("button", { name: "练习记录", exact: true }).click();
  await page.locator(".v-history article").first().waitFor();
  // Seed a historical record to check preservation and filtered export, without private data.
  const historical = {
    id: "historical-fixture",
    title: s.title,
    createdAt: new Date().toISOString(),
    scoreId: s.id,
    scoreVersion: s.version,
    bpm: 120,
    from: 1,
    to: 3,
    completed: true,
    total: 99,
    pitchScore: 100,
    rhythmScore: 98,
    evaluations: [
      {
        key: "0:d",
        measure: 1,
        pitch: true,
        rhythm: 0.5,
        timing: { direction: "late" },
        offset: 0.2,
        actual: 62,
        at: 0.25,
      },
    ],
    suggestions: [{ text: "晚了" }],
    speeds: [],
    reasons: [],
    comment: "节奏需要调整",
  };
  await page.evaluate(
    (r) => localStorage.setItem("zhiyin-v2-records", JSON.stringify([r])),
    historical,
  );
  await page.reload();
  await page.getByRole("button", { name: "练习记录", exact: true }).click();
  await page.getByRole("button", { name: "查看", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出音高记录 ↓", exact: true })
    .click();
  const file = await download;
  const data = JSON.parse(await readFile(await file.path(), "utf8"));
  assert.equal(data.rhythmScore, undefined);
  assert.equal(data.total, undefined);
  assert.equal(data.evaluations[0].rhythm, undefined);
  assert.equal(data.evaluations[0].timing, undefined);
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("zhiyin-v2-records"))[0].total,
    ),
    99,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(uploads, []);
  await writeFile(
    "outputs/accompaniment-browser.json",
    JSON.stringify(
      {
        audioRms: rms,
        scheduledNotes: starts.length,
        micCalls: 0,
        uploads: 0,
        viewport: "390×844",
        checks: [
          "JSON import and rejection",
          "rest/dotted/repeat/ramp playback",
          "pause/resume",
          "live tempo and pitch independence",
          "range",
          "history persistence",
          "legacy export filtering",
          "no horizontal overflow",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Accompaniment: actual Web Audio output, import/rests/repeats/ramp, pause/resume/speed/range, history/export, no mic or uploads: PASS",
  );
} finally {
  await browser.close();
}
