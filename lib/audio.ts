import { hzToMidi } from "./music-core.mjs";
import { InstrumentPitchDetector } from "./pitch-detector.mjs";
export type Frame = {
  assessment?: boolean;
  time: number;
  midi: number | null;
  confidence: number;
  rms: number;
  peak: number;
  attack: number | null;
};
export class LocalAudio {
  context: AudioContext | null = null;
  stream: MediaStream | null = null;
  node: AudioWorkletNode | null = null;
  recorder: MediaRecorder | null = null;
  chunks: Blob[] = [];
  recordingStart = 0;
  output: AudioContext | null = null;
  onFrame: (f: Frame) => void = () => {};
  onInterrupted: () => void = () => {};
  closed = false;
  detector = new InstrumentPitchDetector();
  assessment: Worker | null = null;
  assessmentPending = 0;
  setAssessment(active: boolean) {
    this.assessment?.terminate();
    this.assessment = null;
    this.assessmentPending = 0;
    if (!active) return;
    const w = new Worker(
      `${location.pathname.replace(/\/$/, "")}/review-assets/assessment-worker.js?v=0.7.0`,
    );
    this.assessment = w;
    w.onmessage = ({ data }) => {
      if (this.assessment !== w || this.closed) return;
      this.assessmentPending = Math.max(0, this.assessmentPending - 1);
      if (data.error || data.gap || this.time - data.through > 0.35) {
        this.setAssessment(false);
        this.onInterrupted();
        return;
      }
      for (const event of data.events)
        this.onFrame({
          time: this.time,
          midi: event.midi,
          confidence: event.confidence,
          rms: 0,
          peak: 0,
          attack: event.at,
          assessment: true,
        });
    };
    w.onerror = () => {
      if (this.assessment === w) {
        this.setAssessment(false);
        this.onInterrupted();
      }
    };
  }
  inputSettings: MediaTrackSettings | null = null;
  async open() {
    this.closed = false;
    if (this.context?.state === "running" && this.stream?.active) return;
    this.close();
    this.closed = false;
    if (!window.isSecureContext)
      throw new Error("麦克风需要 HTTPS 或本机 localhost，请从安全地址打开。");
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("浏览器不支持采音，请换用 Safari 或 Chrome。");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.inputSettings =
        this.stream.getAudioTracks()[0]?.getSettings() ?? null;
      await this.context.resume();
      await this.context.audioWorklet.addModule(
        `${location.pathname.replace(/\/$/, "")}/capture-worklet.js?v=0.7.0`,
      );
      this.node = new AudioWorkletNode(this.context, "zheng-capture");
      this.context.createMediaStreamSource(this.stream).connect(this.node);
      const mute = this.context.createGain();
      mute.gain.value = 0;
      this.node.connect(mute).connect(this.context.destination);
      this.node.port.onmessage = ({ data }) => {
        if (this.closed) return;
        const result = this.detector.detect(data.frame, data.sampleRate);
        this.onFrame({
          time: data.time,
          midi: result.frequency > 0 ? hzToMidi(result.frequency) : null,
          confidence: result.confidence,
          rms: data.rms,
          peak: data.peak,
          attack: data.attack,
        });
        if (this.assessment) {
          if (!data.chunk || ++this.assessmentPending > 10) {
            this.setAssessment(false);
            this.onInterrupted();
            return;
          }
          this.assessment.postMessage(
            {
              chunk: data.chunk,
              sampleRate: data.sampleRate,
              startTime: data.startTime,
            },
            [data.chunk.buffer],
          );
        }
      };
      for (const track of this.stream.getTracks()) {
        track.onended = () => this.onInterrupted();
        track.onmute = () => this.onInterrupted();
      }
      this.context.onstatechange = () => {
        if (!this.closed && this.context?.state === "suspended")
          this.onInterrupted();
      };
    } catch (e) {
      this.close();
      throw e;
    }
  }
  get time() {
    return this.context?.currentTime ?? 0;
  }
  startRecording() {
    this.chunks = [];
    if (!this.stream || typeof MediaRecorder === "undefined") return false;
    try {
      this.recorder = new MediaRecorder(this.stream);
      this.recordingStart = this.time;
      this.recorder.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      this.recorder.start(1000);
      return true;
    } catch {
      this.recorder = null;
      return false;
    }
  }
  async stopRecording(): Promise<Blob | null> {
    const r = this.recorder;
    if (!r || r.state === "inactive") return null;
    return new Promise((resolve) => {
      let done = false;
      const finish = (blob: Blob | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(blob);
        this.chunks = [];
        this.recorder = null;
      };
      const timer = setTimeout(() => finish(null), 3000);
      r.onstop = () => finish(new Blob(this.chunks, { type: r.mimeType }));
      r.onerror = () => finish(null);
      try {
        r.stop();
      } catch {
        finish(null);
      }
    });
  }
  async preview(
    notes: {
      time: number;
      end: number;
      midi: number | null;
    }[],
    duration: number,
  ) {
    this.stopPreview();
    this.output = new AudioContext();
    await this.output.resume();
    const ctx = this.output,
      start = ctx.currentTime + 0.08;
    for (const n of notes) {
      if (n.midi === null) continue;
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
      gain.gain.setValueAtTime(0.0001, start + n.time);
      gain.gain.exponentialRampToValueAtTime(0.16, start + n.time + 0.012);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        start + Math.max(n.time + 0.03, n.end),
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + n.time);
      osc.stop(start + n.end + 0.04);
    }
    return duration;
  }
  stopPreview() {
    if (this.output) {
      void this.output.close().catch(() => {});
      this.output = null;
    }
  }
  close() {
    this.setAssessment(false);
    this.closed = true;
    this.stopPreview();
    this.node?.disconnect();
    this.node = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }
}
