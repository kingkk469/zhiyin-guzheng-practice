"use client";
import { STRINGS } from "../lib/practice-core";
import { noteName } from "../lib/music-core.mjs";
export default function StringGuide({ current = 0 }: { current?: number }) {
  return (
    <section className="string-guide" aria-label="新手拨弦示意图">
      <div>
        <span className="eyebrow">先认弦，再拨弦</span>
        <h2>从靠近身体的第1弦，向外逐根拨。</h2>
        <p>
          坐在正常弹奏位置：第1弦最细、音最高，第21弦最粗、音最低。在琴码右侧拨弦，每次只拨一根，左手不要按弦。
        </p>
        <p>
          <b>第1弦 → 第2弦 → …… → 第21弦</b>。这是换弦顺序，不是一次扫过21根弦。
        </p>
        <small>
          下图为俯视示意，琴弦间距已放大。请先核对琴的弦号及D调定弦。
        </small>
      </div>
      <svg
        viewBox="0 0 700 390"
        role="img"
        aria-label="演奏者在下方，第一弦靠近身体，从下向上换弦，在琴码右侧拨响"
      >
        <defs>
          <marker
            id="pluck-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0L10 5L0 10Z" fill="#b44336" />
          </marker>
        </defs>
        <rect
          x="75"
          y="40"
          width="530"
          height="285"
          rx="45"
          fill="#e7d9c1"
          stroke="#ad916b"
        />
        <rect x="365" y="48" width="120" height="270" rx="16" fill="#fff8e9" />
        {STRINGS.map((m, i) => {
          const y = 305 - i * 12;
          const x = 175 + i * 5;
          return (
            <g key={i}>
              <line
                x1="95"
                y1={y}
                x2="580"
                y2={y}
                stroke={i === current ? "#b44336" : "#857f6e"}
                strokeWidth={i === current ? 3 : 1 + i * 0.025}
              />
              <path
                d={`M${x - 5} ${y + 4}L${x} ${y - 6}L${x + 5} ${y + 4}Z`}
                fill="#725d40"
              />
              <text
                x="60"
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#383c35"
              >
                {i + 1}
              </text>
              {i === current && (
                <>
                  <circle cx="425" cy={y} r="7" fill="#b44336" />
                  <text x="493" y={y - 4} fontSize="12" fill="#8b2820">
                    第{i + 1}弦 {noteName(m)}
                  </text>
                </>
              )}
            </g>
          );
        })}
        <path
          d="M635 303L635 65"
          stroke="#b44336"
          strokeWidth="3"
          markerEnd="url(#pluck-arrow)"
        />
        <text
          x="655"
          y="173"
          fontSize="13"
          fill="#8b2820"
          style={{ writingMode: "vertical-rl" }}
        >
          向远离身体的方向换弦
        </text>
        <text x="92" y="25" fontSize="14">
          远处 · 第21弦 · 粗弦 / 低音
        </text>
        <text x="367" y="25" fontSize="14">
          琴码右侧 · 在此拨弦
        </text>
        <text x="95" y="346" fontSize="14">
          近处 · 第1弦 · 细弦 / 高音
        </text>
        <rect x="293" y="354" width="155" height="30" rx="15" fill="#355f51" />
        <text x="371" y="374" fontSize="14" fill="white" textAnchor="middle">
          你坐在这一侧
        </text>
      </svg>
    </section>
  );
}
