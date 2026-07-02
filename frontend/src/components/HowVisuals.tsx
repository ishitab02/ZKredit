/** Bold, glowing SVG illustrations for the How-it-works steps. Driven by
 *  currentColor (parent sets the accent). Looping motion via hiw-* classes. */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-full w-full">
      <div
        className="pointer-events-none absolute inset-[14%] rounded-full opacity-55 blur-[60px]"
        style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
      />
      <div
        className="relative h-full w-full"
        style={{ filter: "drop-shadow(0 0 6px currentColor)" }}
      >
        {children}
      </div>
    </div>
  );
}

export function WalletScan() {
  const nodes = [
    [44, 58],
    [110, 40],
    [176, 66],
    [58, 128],
    [130, 132],
    [92, 186],
    [176, 158],
  ];
  const edges = [
    [0, 1],
    [1, 2],
    [0, 3],
    [1, 4],
    [3, 4],
    [4, 6],
    [3, 5],
    [4, 5],
    [2, 6],
  ];
  return (
    <Frame>
      <svg viewBox="0 0 220 220" className="h-full w-full">
        <g opacity={0.5}>
          {edges.map(([a, b], i) => (
            <line
              key={i}
              x1={nodes[a][0]}
              y1={nodes[a][1]}
              x2={nodes[b][0]}
              y2={nodes[b][1]}
              {...STROKE}
              strokeWidth={1.4}
            />
          ))}
        </g>
        <g {...STROKE}>
          <rect x={92} y={96} width={36} height={26} rx={5} />
          <path d="M92 104h36" strokeWidth={1.4} />
          <circle cx={120} cy={113} r={2.4} fill="currentColor" stroke="none" />
        </g>
        {nodes.map(([x, y], i) => (
          <g key={i} className="hiw-pulse" style={{ animationDelay: `${i * 0.28}s` }}>
            <circle cx={x} cy={y} r={5.5} fill="currentColor" opacity={0.9} />
            <circle cx={x} cy={y} r={10} {...STROKE} strokeWidth={1} opacity={0.4} />
          </g>
        ))}
      </svg>
      <div
        className="hiw-scan absolute inset-x-[8%] top-0 h-[16%] rounded-full"
        style={{
          background: "linear-gradient(to bottom, transparent, currentColor, transparent)",
        }}
      />
    </Frame>
  );
}

export function NeuralScore() {
  const cols = [
    { x: 42, ys: [58, 104, 150] },
    { x: 110, ys: [44, 88, 132, 176] },
    { x: 178, ys: [80, 128] },
  ];
  const connect: Array<[number[], number[]]> = [];
  cols[0].ys.forEach((y1) =>
    cols[1].ys.forEach((y2) => connect.push([[cols[0].x, y1], [cols[1].x, y2]])),
  );
  cols[1].ys.forEach((y1) =>
    cols[2].ys.forEach((y2) => connect.push([[cols[1].x, y1], [cols[2].x, y2]])),
  );
  return (
    <Frame>
      <svg viewBox="0 0 220 220" className="h-full w-full">
        <g opacity={0.55}>
          {connect.map(([[x1, y1], [x2, y2]], i) => (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              {...STROKE}
              strokeWidth={1.1}
              strokeDasharray="4 8"
              className="hiw-dash"
              style={{ animationDelay: `${(i % 7) * 0.12}s` }}
            />
          ))}
        </g>
        {cols.map((c, ci) =>
          c.ys.map((y, i) => (
            <circle
              key={`${ci}-${i}`}
              cx={c.x}
              cy={y}
              r={ci === 2 ? 7 : 5.5}
              fill="currentColor"
              className="hiw-pulse"
              style={{ animationDelay: `${(ci * 3 + i) * 0.18}s` }}
            />
          )),
        )}
        <g transform="translate(178,128)">
          <circle r={18} {...STROKE} strokeWidth={2.5} opacity={0.25} />
          <circle
            r={18}
            {...STROKE}
            strokeWidth={2.5}
            strokeDasharray="85 200"
            transform="rotate(-90)"
          />
        </g>
      </svg>
    </Frame>
  );
}

export function ZkProof() {
  return (
    <Frame>
      <svg viewBox="0 0 220 220" className="h-full w-full">
        <circle
          cx={110}
          cy={110}
          r={78}
          {...STROKE}
          strokeWidth={1.4}
          strokeDasharray="2 12"
          opacity={0.55}
          className="hiw-spin"
        />
        <g {...STROKE} strokeWidth={1.4} opacity={0.6}>
          <path d="M110 32v20M110 168v20M32 110h20M168 110h20" className="hiw-dash" strokeDasharray="4 6" />
          <circle cx={110} cy={30} r={3} fill="currentColor" stroke="none" />
          <circle cx={110} cy={190} r={3} fill="currentColor" stroke="none" />
          <circle cx={30} cy={110} r={3} fill="currentColor" stroke="none" />
          <circle cx={190} cy={110} r={3} fill="currentColor" stroke="none" />
        </g>
        <g {...STROKE} className="hiw-float">
          <rect x={84} y={104} width={52} height={42} rx={8} />
          <path d="M94 104v-10a16 16 0 0 1 32 0v10" />
          <circle cx={110} cy={122} r={4} fill="currentColor" stroke="none" />
          <path d="M110 126v8" />
        </g>
        <g transform="translate(150,150)">
          <circle r={14} fill="currentColor" opacity={0.16} />
          <path d="M-6 0l4 4 8-9" {...STROKE} strokeWidth={2.4} />
        </g>
      </svg>
    </Frame>
  );
}

export function OnChain() {
  return (
    <Frame>
      <svg viewBox="0 0 220 220" className="h-full w-full">
        <g {...STROKE} className="hiw-float">
          <path d="M110 34l50 20v34c0 32-21 54-50 66-29-12-50-34-50-66V54l50-20z" />
          <path d="M92 108l14 14 28-30" strokeWidth={2.6} />
        </g>
        <text
          x={110}
          y={172}
          textAnchor="middle"
          fill="currentColor"
          opacity={0.85}
          style={{ font: "600 11px 'Space Mono', monospace", letterSpacing: "1px" }}
        >
          0x9F3A…B7E1
        </text>
        <g transform="translate(110,196)">
          {[-1, 0, 1].map((k, i) => (
            <g key={k} transform={`translate(${k * 30},0)`}>
              <rect
                x={-11}
                y={-9}
                width={22}
                height={18}
                rx={4}
                {...STROKE}
                strokeWidth={1.6}
                className="hiw-pulse"
                style={{ animationDelay: `${i * 0.3}s` }}
              />
              {k < 1 && <line x1={11} y1={0} x2={19} y2={0} {...STROKE} strokeWidth={1.6} />}
            </g>
          ))}
        </g>
      </svg>
    </Frame>
  );
}

const VISUALS = [WalletScan, NeuralScore, ZkProof, OnChain];

export default function StepVisual({ step }: { step: number }) {
  const V = VISUALS[step] ?? WalletScan;
  return <V />;
}
