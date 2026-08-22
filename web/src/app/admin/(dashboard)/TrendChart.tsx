interface Props {
  label: string;
  values: number[];
  days: string[];
}

// Deliberately not a chart library - this is one bar chart, four times,
// on an internal admin page. An inline SVG keeps it dependency-free and
// trivially themeable with the same palette as the rest of the dashboard.
export function TrendChart({ label, values, days }: Props) {
  const max = Math.max(1, ...values);
  const width = 320;
  const height = 64;
  const barWidth = width / values.length;
  const total = values.reduce((sum, v) => sum + v, 0);

  return (
    <div className="rounded-xl border border-[#EDEBE3] bg-white p-5">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-xs text-[#888780]">{label}</div>
        <div className="text-xs text-[#888780]">{total} total</div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
        {values.map((v, i) => {
          const barHeight = (v / max) * (height - 4);
          return (
            <rect
              key={days[i]}
              x={i * barWidth + 1}
              y={height - barHeight}
              width={Math.max(barWidth - 2, 1)}
              height={barHeight}
              rx={1}
              className="fill-[#3D6A5B]"
            >
              <title>
                {days[i]}: {v}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[#888780]">
        <span>{days[0]}</span>
        <span>{days[days.length - 1]}</span>
      </div>
    </div>
  );
}
