import test from "node:test";
import assert from "node:assert/strict";
import { Accompaniment } from "../lib/accompaniment.ts";
import { guzhengWave } from "../lib/guzheng-voice.ts";
import { makeTimeline, validateScore, STRINGS } from "../lib/practice-core.ts";
import { SCORES } from "../lib/scores.ts";
import { InstrumentPitchDetector } from "../lib/pitch-detector.mjs";

test("procedural plucks have finite bounded output and preserve pitch across the 21 strings", () => {
  const detector = new InstrumentPitchDetector();
  for (const midi of STRINGS) {
    for (const rate of [44100, 48000]) {
      const wave = guzhengWave(midi, rate);
      assert.equal(wave.length, rate * 4);
      let peak = 0,
        early = 0,
        late = 0;
      for (let i = 0; i < wave.length; i++) {
        assert.ok(Number.isFinite(wave[i]));
        peak = Math.max(peak, Math.abs(wave[i]));
        if (i < rate / 2) early += wave[i] ** 2;
        if (i > rate * 3.5) late += wave[i] ** 2;
      }
      assert.ok(peak <= 0.521);
      assert.ok(early > late * 20);
      const detected = detector.detect(
        wave.slice(Math.round(rate * 0.08), Math.round(rate * 0.08) + 4096),
        rate,
      );
      const cents =
        1200 * Math.log2(detected.frequency / (440 * 2 ** ((midi - 69) / 12)));
      assert.ok(Math.abs(cents) < 8, `${midi}@${rate}: ${cents}`);
    }
  }
});

test("playback imports do not need grading flags; rests, repeats, tempo integration and range remain exact", () => {
  for (const original of SCORES) {
    const playable = { ...original, minBpm: 20, maxBpm: 240 };
    assert.deepEqual(validateScore(playable), []);
    for (const speed of [20, 240]) {
      const t = makeTimeline(playable, speed);
      assert.ok(t.duration > 0 && t.events.every(n => n.end > n.time));
    }
  }
  const s = structuredClone(SCORES.find((s) => s.id === "daily-rhythm-2"));
  for (const b of s.bars)
    for (const n of b.notes) {
      delete n.pitch;
      delete n.rhythm;
    }
  s.order = [0, 1, 0];
  s.tempo = [
    { beat: 0, ratio: 1, ramp: true },
    { beat: 4, ratio: 1.5, ramp: false },
  ];
  assert.deepEqual(validateScore(s), []);
  const slow = makeTimeline(s, 40),
    fast = makeTimeline(s, 80);
  assert.equal(slow.events[0].midi, null);
  assert.equal(
    slow.events.filter((n) => n.source === 0).length,
    s.bars[0].notes.length * 2,
  );
  assert.equal(new Set(slow.events.map((n) => n.key)).size, slow.events.length);
  assert.ok(Math.abs(slow.duration - fast.duration * 2) < 1e-8);
  for (let i = 0; i < fast.events.length; i++) {
    assert.equal(slow.events[i].midi, fast.events[i].midi);
    assert.ok(Math.abs(slow.events[i].time - fast.events[i].time * 2) < 1e-8);
  }
  assert.equal(makeTimeline(s, 80, 2, 2).bars[0].start, 0);
  s.bars[0].notes[0].duration = 0.2;
  assert.ok(validateScore(s).some((e) => /不连续|拍数/.test(e)));
});

test("transport pauses exactly, resumes inside a note, changes tempo without changing playbackRate, cancels pending starts", async () => {
  const original = globalThis.AudioContext;
  const starts = [];
  class Context {
    currentTime = 0;
    sampleRate = 8000;
    state = "running";
    destination = {};
    async resume() {}
    async close() {
      this.state = "closed";
    }
    createBuffer(_, length, rate) {
      return { duration: length / rate, copyToChannel() {} };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {
          return this;
        },
        disconnect() {},
      };
    }
    createBufferSource() {
      return {
        playbackRate: { value: 1 },
        connect(target) {
          return target;
        },
        disconnect() {},
        stop() {},
        start(...args) {
          starts.push({ args, rate: this.playbackRate.value });
        },
      };
    }
  }
  globalThis.AudioContext = Context;
  const p = new Accompaniment();
  const t = {
    events: [
      { time: 0, end: 1, midi: 62 },
      { time: 1, end: 2, midi: null },
      { time: 2, end: 3, midi: 69 },
    ],
    duration: 3,
  };
  try {
    await p.play(t, 0);
    assert.equal(starts.length, 1);
    p.context.currentTime = 0.55;
    p.pause();
    assert.equal(p.time, 0.5);
    p.context.currentTime = 1;
    assert.equal(p.time, 0.5);
    await p.play(t);
    assert.equal(starts.at(-1).args[1], 0.5);
    p.context.currentTime = p.anchor + 0.25;
    await p.changeTempo({
      ...t,
      events: t.events.map((n) => ({ ...n, time: n.time / 2, end: n.end / 2 })),
      duration: 1.5,
    });
    assert.ok(Math.abs(p.position - 0.375) < 1e-8);
    assert.ok(starts.every((s) => s.rate === 1));
    p.pause();
    p.position = 0;
    const before = starts.length;
    const pending = p.play(t);
    p.pause();
    await pending;
    assert.equal(p.playing, false);
    assert.equal(starts.length, before);
  } finally {
    p.close();
    globalThis.AudioContext = original;
  }
});
