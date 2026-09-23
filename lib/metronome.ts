import type { Timeline } from "./practice-core";
export type ClickTone = "wood" | "soft" | "digital";
export function clickPlan(t: Timeline, beatsPerBar: number) {
  return [
    ...Array.from({ length: beatsPerBar }, (_, i) => ({
      at: -t.countIn + (i * t.countIn) / beatsPerBar,
      accent: i === 0,
    })),
    ...t.beats.map((at, i) => ({ at, accent: i % beatsPerBar === 0 })),
  ];
}
export class Metronome {
  context: AudioContext | null = null;
  nodes = new Set<OscillatorNode>();
  timer: ReturnType<typeof setInterval> | null = null;
  async open(context?: AudioContext) {
    this.stop();
    if (this.context && this.context !== context)
      await this.context.close().catch(() => {});
    this.context = context ?? new AudioContext();
    await this.context.resume();
  }
  start(
    t: Timeline,
    beats: number,
    scoreStart: number,
    tone: ClickTone,
    volume: number,
  ) {
    this.stop();
    const ctx = this.context!;
    const plan = clickPlan(t, beats);
    let index = 0;
    const schedule = () => {
      while (
        index < plan.length &&
        scoreStart + plan[index].at < ctx.currentTime + 0.12
      ) {
        const beat = plan[index++],
          at = scoreStart + beat.at;
        if (at < ctx.currentTime - 0.025) continue;
        const osc = ctx.createOscillator(),
          gain = ctx.createGain();
        const when = Math.max(at, ctx.currentTime),
          length = tone === "soft" ? 0.065 : 0.035;
        osc.type =
          tone === "wood" ? "triangle" : tone === "digital" ? "square" : "sine";
        osc.frequency.setValueAtTime(
          (tone === "wood" ? 1200 : tone === "soft" ? 800 : 2000) *
            (beat.accent ? 1.4 : 1),
          when,
        );
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(
          volume * (beat.accent ? 0.24 : 0.16),
          when + 0.002,
        );
        gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
        osc.connect(gain).connect(ctx.destination);
        this.nodes.add(osc);
        osc.onended = () => {
          this.nodes.delete(osc);
          osc.disconnect();
          gain.disconnect();
        };
        osc.start(when);
        osc.stop(when + length + 0.005);
      }
      if (index === plan.length && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
    this.timer = setInterval(schedule, 25);
    schedule();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {}
    }
    this.nodes.clear();
  }
}
