"use client";
import { useState } from "react";
import type { Frame } from "../lib/audio";
import { STRINGS } from "../lib/practice-core";
import { noteName, midiToHz } from "../lib/music-core.mjs";

type Sample = { string: number; note: string; hz: number; time: string };
export default function TunerComparison({
  frame,
  index,
}: {
  frame: Frame | null;
  index: number;
}) {
  const [sample, setSample] = useState<Sample | null>(null);
  const [reference, setReference] = useState("");
  const referenceHz = Number(reference);
  const valid =
    Number.isFinite(referenceHz) && referenceHz >= 65 && referenceHz <= 1400;
  const difference =
    sample && valid ? 1200 * Math.log2(sample.hz / referenceHz) : null;
  return (
    <details className="tuning-diagnostics tuner-comparison">
      <summary>与 Tuner Lite 对照读数</summary>
      <p>
        两边均采用 A4 = 440
        Hz、十二平均律。先在这里单拨并记录，再切到另一款调音器重新拨同一根弦。保持琴、手机位置与拨弦力度接近；不要同时开两个麦克风。
      </p>
      <button
        className="secondary-button"
        disabled={frame?.midi == null}
        onClick={() => {
          if (frame?.midi == null) return;
          setSample({
            string: index + 1,
            note: noteName(STRINGS[index]),
            hz: midiToHz(frame.midi),
            time: new Date().toISOString(),
          });
          setReference("");
        }}
      >
        记录当前稳定读数
      </button>
      {sample && (
        <>
          <p>
            已记录第 {sample.string} 弦（目标 {sample.note}）：
            <b>{sample.hz.toFixed(2)} Hz</b>
            。这是手动保留的对照值，不是实时读数。
          </p>
          <label>
            另一款调音器的实际频率（Hz）
            <input
              type="number"
              inputMode="decimal"
              min="65"
              max="1400"
              step="0.01"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="例如 293.66"
            />
          </label>
          {reference && !valid && <p>请输入 65–1400 Hz 范围内的频率。</p>}
          {difference !== null && (
            <p role="status">
              两次读数相差 {difference > 0 ? "+" : ""}
              {difference.toFixed(1)}{" "}
              音分（正数表示本软件较高）。分次拨弦也会带来差异，请重复对照；此数值不会用于自动校正或调弦。
            </p>
          )}
          <button
            className="secondary-button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    JSON.stringify(
                      {
                        version: "0.3.3",
                        referenceA4: 440,
                        temperament: "equal",
                        sample,
                        referenceHz: valid ? referenceHz : null,
                        differenceCents: difference,
                        browser: navigator.userAgent,
                      },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                ),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "调音对照记录.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            保存这次对照（不含录音）
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              setSample(null);
              setReference("");
            }}
          >
            清除对照
          </button>
        </>
      )}
      <p>只在当前页面保留，可自行保存到手机；不会上传。刷新页面后清除。</p>
    </details>
  );
}
