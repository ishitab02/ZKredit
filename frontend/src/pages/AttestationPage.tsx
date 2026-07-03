import { ArrowUpRight } from "../components/Icons";
import TryAttestation from "../components/TryAttestation";
import { ATTESTATION_PATH, LANDING_PATH } from "../lib/navigation";

export default function AttestationPage() {
  return (
    <>
      <section className="relative overflow-hidden pt-28 md:pt-32">
        <div className="absolute inset-0 bg-dotgrid opacity-25" />
        <div className="container-page relative z-10">
          <div className="mx-auto flex max-w-4xl flex-col gap-6">
            <p className="eyebrow">
              <span className="accent-dot h-1.5 w-1.5 rounded-full" />
              Attestation page
            </p>
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="max-w-2xl">
                <h1 className="font-display text-display-md font-semibold leading-[0.95] text-fog">
                  Request a wallet attestation.
                </h1>
                <p className="mt-5 max-w-xl text-base leading-relaxed text-fog-muted md:text-lg">
                  Connect Freighter or paste a Stellar G-address to run the full
                  scoring flow. This page shows the attestation output,
                  proof status, reason codes, and model details.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href={LANDING_PATH} className="btn-ghost">
                  Back to landing
                </a>
                <a href={`${ATTESTATION_PATH}#attestation`} className="btn-primary">
                  Start attestation
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <TryAttestation />
    </>
  );
}
