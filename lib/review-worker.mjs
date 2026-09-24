import * as tf from "@tensorflow/tfjs";
import { reviewResidual } from "./residual-review.mjs";
import {
  captureAttackEvidence,
  organizeReviewCandidates,
} from "./review-candidates.mjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import {
  BasicPitch,
  outputToNotesPoly,
  noteFramesToTime,
} from "@spotify/basic-pitch";

// One job per worker. Termination cancels inference and releases all model memory.
self.onmessage = async ({ data }) => {
  const { samples, assets } = data;
  let model;
  try {
    if (
      !(samples instanceof Float32Array) ||
      samples.length > 22050 * 30 ||
      !samples.length
    )
      throw Error("录音需为30秒以内。");
    self.postMessage({
      type: "progress",
      text: "正在加载本机识别模型…",
      progress: 0,
    });
    tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
    setWasmPaths(assets);
    try {
      if (!(await tf.setBackend("wasm"))) throw Error("wasm unavailable");
      await tf.ready();
    } catch {
      await tf.setBackend("cpu");
      await tf.ready();
    }
    const [manifestResponse, weightsResponse] = await Promise.all([
      fetch(assets + "model.json"),
      fetch(assets + "weights.data"),
    ]);
    if (!manifestResponse.ok || !weightsResponse.ok)
      throw Error("模型下载失败，请联网后重试。");
    const manifest = await manifestResponse.json(),
      weights = await weightsResponse.arrayBuffer();
    if (weights.byteLength !== 742392)
      throw Error("模型下载不完整，请刷新后重试。");
    model = await tf.loadGraphModel({
      load: async () => ({
        modelTopology: manifest.modelTopology,
        weightSpecs: manifest.weightsManifest.flatMap((m) => m.weights),
        weightData: weights,
      }),
    });
    const engine = new BasicPitch(Promise.resolve(model));
    const run = async () => {
      const frames = [],
        onsets = [];
      // Use the upstream implementation unchanged. A fresh, bounded worker is
      // terminated after each result/cancel, releasing the model and tensors.
      await engine.evaluateModel(
        samples,
        (f, o) => {
          frames.push(...f);
          onsets.push(...o);
        },
        (p) => {
          self.postMessage({
            type: "progress",
            text: "正在辨认录音中的音符…",
            progress: Math.round(p * 95),
          });
        },
      );
      const noteFrames = outputToNotesPoly(
        frames.map((r) => r.slice()),
        onsets.map((r) => r.slice()),
        0.5,
        0.3,
        5,
      );
      const evidence = captureAttackEvidence(frames, onsets, noteFrames);
      const ordered = noteFramesToTime(noteFrames)
        .map((note, i) => ({ note, evidence: evidence[i] }))
        .sort(
          (a, b) =>
            a.note.startTimeSeconds - b.note.startTimeSeconds ||
            a.note.pitchMidi - b.note.pitchMidi,
        );
      const notes = ordered.map((n) => n.note);
      return {
        notes,
        review: organizeReviewCandidates(
          notes,
          ordered.map((n) => n.evidence),
        ),
      };
    };
    let notes;
    try {
      notes = await run();
    } catch (error) {
      if (tf.getBackend() !== "wasm") throw error;
      self.postMessage({
        type: "progress",
        text: "正在切换兼容模式…",
        progress: 0,
      });
      await tf.setBackend("cpu");
      await tf.ready();
      notes = await run();
    }
    self.postMessage({
      type: "done",
      ...notes,
      residual: reviewResidual(samples),
      backend: tf.getBackend(),
      duration: samples.length / 22050,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "识别失败，请重试。",
    });
  } finally {
    model?.dispose();
  }
};
