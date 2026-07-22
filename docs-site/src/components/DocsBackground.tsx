import { useMemo, type CSSProperties } from "react";

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinkle: boolean;
  twinklePeak: number;
  twinkleDuration: number;
  twinkleDelay: number;
  driftX: number;
  driftY: number;
  driftDuration: number;
  driftDelay: number;
}

/** Deterministic pseudo-random stars, generated once per session so the field
 *  doesn't reshuffle on re-render. Every star drifts slowly for a live-wallpaper
 *  feel; a large share also twinkle, each to its own peak brightness, on its own
 *  desynced cycle, so the glow reads as varied rather than uniform. */
function generateStars(count: number, seed: number): Star[] {
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) % 2147483647;
    return s / 2147483647;
  };
  return Array.from({ length: count }, () => {
    const opacity = 0.1 + next() * 0.4;
    return {
      x: next() * 100,
      y: next() * 100,
      size: 1 + next() * 1.5,
      opacity,
      twinkle: next() < 0.42,
      twinklePeak: Math.min(opacity * (1.5 + next() * 1.8), 0.9),
      twinkleDuration: 1.6 + next() * 1.8,
      twinkleDelay: next() * 3,
      driftX: (next() - 0.5) * 46,
      driftY: (next() - 0.5) * 46,
      driftDuration: 6 + next() * 8,
      driftDelay: next() * 6,
    };
  });
}

const PRIMARY_RINGS = [90, 150, 210, 270, 330, 390];
const SECONDARY_RINGS = [60, 110, 160];

export default function DocsBackground() {
  const stars = useMemo(() => generateStars(260, 87), []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-900">
      {/* base wash: teal glow anchored top-left fading to near-black, matching the brand banner */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 75% at 8% 8%, rgba(127,235,217,0.15) 0%, rgba(0,130,124,0.09) 26%, rgba(1,32,26,0.32) 50%, #03140F 78%)",
        }}
      />

      {/* faint secondary wash, bottom-right, for balance across the full viewport */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 55% at 96% 100%, rgba(0,130,124,0.08) 0%, rgba(1,32,26,0.05) 40%, transparent 70%)",
        }}
      />

      {/* primary sonar rings, top-left: static concentric rings, breathing subtly */}
      <svg
        className="ring-breathe absolute -left-[16%] -top-[18%] h-[80vmin] w-[80vmin]"
        viewBox="0 0 800 800"
        fill="none"
      >
        {PRIMARY_RINGS.map((r, i) => (
          <circle key={r} cx="400" cy="400" r={r} stroke="#7FEBD9" strokeOpacity={0.2 - i * 0.026} strokeWidth="1" />
        ))}
      </svg>

      {/* faint echo rings, bottom-right, breathing on its own slightly offset cycle */}
      <svg
        className="ring-breathe-slow absolute -bottom-[12%] -right-[10%] h-[46vmin] w-[46vmin]"
        viewBox="0 0 400 400"
        fill="none"
      >
        {SECONDARY_RINGS.map((r, i) => (
          <circle key={r} cx="200" cy="200" r={r} stroke="#7FEBD9" strokeOpacity={0.1 - i * 0.024} strokeWidth="1" />
        ))}
      </svg>

      {/* starfield, spread across the full page and slowly drifting; a large
          share also twinkle to their own peak brightness, each on its own
          faster, desynced cycle */}
      <svg className="absolute inset-0 h-full w-full">
        {stars.map((star, i) => {
          const animations = [
            `star-drift ${star.driftDuration}s ease-in-out ${star.driftDelay}s infinite`,
          ];
          if (star.twinkle) {
            animations.push(`star-twinkle ${star.twinkleDuration}s ease-in-out ${star.twinkleDelay}s infinite`);
          }
          return (
            <circle
              key={i}
              cx={`${star.x}%`}
              cy={`${star.y}%`}
              r={star.size / 2}
              fill="#EDFFFE"
              opacity={star.opacity}
              className="star"
              style={
                {
                  "--drift-x": `${star.driftX}px`,
                  "--drift-y": `${star.driftY}px`,
                  "--star-base": star.opacity,
                  "--star-peak": star.twinklePeak,
                  animation: animations.join(", "),
                } as CSSProperties
              }
            />
          );
        })}
      </svg>
    </div>
  );
}
