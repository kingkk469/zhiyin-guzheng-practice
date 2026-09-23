/** One minor division is one cent. The dial scale does not claim detector accuracy. */
export default function CentsDial({ cents }: { cents: number | null }) {
  const valid = cents !== null && Math.abs(cents) <= 100;
  const angle = valid ? Math.max(-50, Math.min(50, cents)) * 1.2 : 0;
  const point = (degrees: number, radius: number) => {
    const a = (degrees * Math.PI) / 180;
    return { x: 200 + Math.sin(a) * radius, y: 218 - Math.cos(a) * radius };
  };
  return (
    <div className="cents-dial">
      <svg
        viewBox="0 0 400 252"
        role="img"
        aria-label={
          valid
            ? `音准刻度盘，相对目标 ${cents.toFixed(1)} 音分，每小格一音分${Math.abs(cents) > 50 ? "，超出刻度范围" : ""}`
            : "音准刻度盘，等待稳定读数，每小格一音分"
        }
      >
        <path
          d="M 35 123 A 190 190 0 0 1 365 123"
          fill="none"
          stroke="#ded6c5"
          strokeWidth="2"
        />
        {Array.from({ length: 101 }, (_, i) => {
          const value = i - 50,
            major = value % 10 === 0,
            mid = value % 5 === 0;
          const start = point(value * 1.2, 184),
            end = point(value * 1.2, major ? 164 : mid ? 170 : 176),
            label = point(value * 1.2, 204);
          return (
            <g key={value} className="dial-tick" data-cent={value}>
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={value === 0 ? "#315c4f" : "#706b5f"}
                strokeWidth={major ? 1.6 : 0.8}
              />
              {major && (
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="12"
                  fill="#454b43"
                >
                  {value > 0 ? `+${value}` : value}
                </text>
              )}
            </g>
          );
        })}
        <line
          x1="200"
          y1="42"
          x2="200"
          y2="218"
          stroke="#315c4f"
          strokeOpacity="0.16"
        />
        <g
          className="dial-needle"
          data-visible={valid}
          style={{
            opacity: valid ? 1 : 0,
            transform: `rotate(${angle}deg)`,
            transformOrigin: "200px 218px",
          }}
        >
          <path d="M 198 216 L 200 40 L 202 216 Z" fill="#b44336" />
          <circle cx="200" cy="218" r="6" fill="#b44336" />
        </g>
        <text x="200" y="160" textAnchor="middle" fontSize="12" fill="#706b5f">
          每小格 1 音分
        </text>
        <text x="35" y="241" textAnchor="start" fontSize="13" fill="#706b5f">
          ♭ 偏低
        </text>
        <text x="365" y="241" textAnchor="end" fontSize="13" fill="#706b5f">
          偏高 ♯
        </text>
      </svg>
      <div className="dial-range">
        {valid && Math.abs(cents) > 50
          ? "已超出 ±50 音分刻度，请参照下方数字"
          : "以中央 0 刻度为目标"}
      </div>
    </div>
  );
}
