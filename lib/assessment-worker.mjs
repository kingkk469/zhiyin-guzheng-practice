import { ResidualStream } from "./residual-stream.mjs";
let detector, origin, end;
self.onmessage = ({ data }) => {
  try {
    const { chunk, sampleRate, startTime } = data;
    const gap = end !== undefined && Math.abs(startTime - end) > 2 / sampleRate;
    if (!detector || gap) {
      detector = new ResidualStream(sampleRate);
      origin = startTime;
    }
    end = startTime + chunk.length / sampleRate;
    self.postMessage({
      events: detector.push(chunk).map((e) => ({ ...e, at: e.at + origin })),
      through: end,
      gap,
    });
  } catch {
    self.postMessage({ error: true });
  }
};
