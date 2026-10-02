import type { Timeline } from "./practice-core";
import { guzhengWave } from "./guzheng-voice.ts";

/** One audio clock for sound and sheet. Speed changes rescale the score clock, never the voice. */
export class Accompaniment {
  context: AudioContext | null = null;
  timeline: Timeline | null = null;
  playing = false;
  position = 0;
  anchor = 0;
  nodes = new Set<AudioBufferSourceNode>();
  buffers = new Map<number, AudioBuffer>();
  timer: ReturnType<typeof setInterval> | null = null;
  generation = 0;
  onEnded = () => {};
  onInterrupted = () => {};
  get time() {
    return this.playing && this.context
      ? Math.min(
          this.timeline?.duration ?? 0,
          this.position + this.context.currentTime - this.anchor,
        )
      : this.position;
  }
  async play(timeline: Timeline, position = this.position) {
    const generation = ++this.generation;
    this.pauseNodes();
    this.playing = false;
    this.context ??= new AudioContext();
    const ctx = this.context;
    ctx.onstatechange = () => {
      if (ctx.state === "suspended" && this.playing) {
        this.pause();
        this.onInterrupted();
      }
    };
    await ctx.resume();
    if (generation !== this.generation) return;
    // Cache before capturing the audio start, so rendering the voice cannot delay first notes.
    for (const midi of new Set(
      timeline.events.flatMap((n) => (n.midi === null ? [] : [n.midi])),
    )) {
      if (!this.buffers.has(midi)) {
        const wave = guzhengWave(midi, ctx.sampleRate);
        const buffer = ctx.createBuffer(1, wave.length, ctx.sampleRate);
        buffer.copyToChannel(wave, 0);
        this.buffers.set(midi, buffer);
        // Let slower mobile devices paint the loading state between generated strings.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (generation !== this.generation) return;
      }
    }
    this.timeline = timeline;
    this.position = Math.max(0, Math.min(position, timeline.duration));
    this.anchor = ctx.currentTime + 0.05;
    this.playing = true;
    const startPosition = this.position;
    let index = timeline.events.findIndex(
      (n) => n.end > startPosition + 0.00001,
    );
    if (index < 0) index = timeline.events.length;
    const schedule = () => {
      if (!this.playing) return;
      const now = this.time;
      while (
        index < timeline.events.length &&
        timeline.events[index].time < now + 0.12
      ) {
        const note = timeline.events[index++];
        if (note.midi === null || note.end <= now) continue;
        const source = ctx.createBufferSource();
        source.buffer = this.buffers.get(note.midi)!;
        const gain = ctx.createGain();
        const when = Math.max(
          ctx.currentTime,
          this.anchor + note.time - startPosition,
        );
        const offset = Math.max(0, startPosition - note.time);
        const remaining = note.end - Math.max(startPosition, note.time);
        const length = Math.min(
          remaining + 0.035,
          source.buffer.duration - Math.min(offset, 3.8),
        );
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(0.55, when + 0.005);
        gain.gain.setValueAtTime(0.55, when + Math.max(0.006, length - 0.03));
        gain.gain.linearRampToValueAtTime(0, when + length);
        source.connect(gain).connect(ctx.destination);
        this.nodes.add(source);
        source.onended = () => {
          this.nodes.delete(source);
          source.disconnect();
          gain.disconnect();
        };
        source.start(when, Math.min(offset, 3.8), length);
      }
      if (now >= timeline.duration) {
        this.position = timeline.duration;
        this.playing = false;
        this.pauseNodes();
        this.onEnded();
      }
    };
    this.timer = setInterval(schedule, 25);
    schedule();
  }
  pauseNodes() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {}
    }
    this.nodes.clear();
  }
  pause() {
    ++this.generation;
    this.position = Math.max(0, this.time);
    this.playing = false;
    this.pauseNodes();
  }
  async changeTempo(timeline: Timeline) {
    const fraction = this.timeline ? this.time / this.timeline.duration : 0;
    const playing = this.playing;
    this.pause();
    this.timeline = timeline;
    this.position = fraction * timeline.duration;
    if (playing) await this.play(timeline);
  }
  close() {
    this.pause();
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
    this.context = null;
    this.buffers.clear();
  }
}
