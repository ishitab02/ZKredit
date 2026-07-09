// The calm four-step reveal that maps the backend's many phases onto the
// process a person actually understands: read → prove → sign → verify.
// It is the honest progress surface for the on-chain attestation flow.

export interface StepperMode {
  title: string;
  detail: string;
  tone: "live" | "fixture" | "other";
}

const STEPS = [
  { label: "Read", hint: "reads public history & scores" },
  { label: "Prove", hint: "distilled model, in zero-knowledge" },
  { label: "Sign", hint: "wallet co-signs the envelope" },
  { label: "Verify", hint: "contract verifies the receipt" },
] as const;

// Track-fill percentage for each active step (and 100% once everything is done).
const FILL = [12, 42, 72, 88];

export default function RevealStepper({
  activeIndex,
  allDone,
  mode,
  queue,
}: {
  /** 0–3 while a step is in progress, or null when idle. */
  activeIndex: number | null;
  allDone: boolean;
  mode?: StepperMode | null;
  queue?: { jobId: string; status: string } | null;
}) {
  const fill = allDone ? 100 : activeIndex === null ? 0 : FILL[activeIndex];

  return (
    <div className="mt-2">
      <div className="relative grid grid-cols-4">
        <div className="attest-track left-[12%] right-[12%] top-[19px] z-0">
          <i style={{ width: `${fill}%` }} />
        </div>
        {STEPS.map((s, i) => {
          const done = allDone || (activeIndex !== null && i < activeIndex);
          const active = !allDone && activeIndex === i;
          return (
            <div key={s.label} className="relative z-10 flex flex-col items-center gap-3 text-center">
              {/* Opaque node so the connecting line can never show through the number. */}
              <div
                className={`grid h-10 w-10 place-items-center rounded-full border bg-ink-900 font-mono text-xs transition-all duration-500 ${
                  active
                    ? "border-teal-bright text-teal-bright shadow-[0_0_0_4px_rgba(127,235,217,0.1),0_0_22px_-4px_#7FEBD9]"
                    : done
                      ? "border-[#c6a667] text-[#f6e7c4] shadow-[0_0_18px_-6px_#c6a667]"
                      : "border-white/10 text-fog-faint"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <div
                className={`font-display text-sm font-medium transition-colors duration-500 ${
                  active || done ? "text-fog" : "text-fog-faint"
                }`}
              >
                {s.label}
              </div>
              <div className="hidden max-w-[16ch] font-mono text-[10.5px] leading-tight text-fog-faint/70 md:block">
                {s.hint}
              </div>
            </div>
          );
        })}
      </div>

      {mode && (
        <div className="mt-7">
          <div
            className={`inline-flex items-center gap-3 rounded-[11px] border px-4 py-2.5 text-sm text-fog-muted ${
              mode.tone === "live"
                ? "border-teal-bright/25 bg-teal-bright/[0.06]"
                : mode.tone === "fixture"
                  ? "border-[rgba(250,209,255,0.28)] bg-[rgba(250,209,255,0.05)]"
                  : "border-white/10 bg-white/[0.02]"
            }`}
          >
            <span
              className={`h-[7px] w-[7px] rounded-full ${
                mode.tone === "live"
                  ? "bg-teal-bright shadow-[0_0_9px_#7FEBD9]"
                  : mode.tone === "fixture"
                    ? "bg-haze-pink shadow-[0_0_9px_#FAD1FF]"
                    : "bg-fog-faint"
              }`}
            />
            <span
              className={`font-mono text-[10.5px] uppercase tracking-[0.16em] ${
                mode.tone === "live"
                  ? "text-teal-bright"
                  : mode.tone === "fixture"
                    ? "text-haze-pink"
                    : "text-fog-faint"
              }`}
            >
              {mode.title}
            </span>
            <span>{mode.detail}</span>
          </div>
          {queue && (
            <p className="mt-3 font-mono text-[11px] tracking-[0.04em] text-fog-faint">
              job {queue.jobId} · {queue.status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
