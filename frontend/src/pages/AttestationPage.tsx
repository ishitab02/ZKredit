import TryAttestation from "../components/TryAttestation";

export default function AttestationPage({
  walletAddress,
  onWalletConnected,
}: {
  walletAddress?: string | null;
  onWalletConnected?: (address: string) => void;
}) {
  return (
    <section className="relative overflow-hidden pt-28 pb-24 md:pt-32 md:pb-36">
      <div aria-hidden className="absolute inset-0 bg-dotgrid opacity-25" />
      <div
        aria-hidden
        className="glow left-1/2 top-32 h-[50vmin] w-[74vmin] -translate-x-1/2 animate-pulseglow"
      />
      <div className="container-page relative z-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow mb-5 justify-center">
            <span className="accent-dot h-1.5 w-1.5 rounded-full" />
            Attestation
          </p>
          <h1 className="font-display text-display-md font-semibold leading-[0.95] text-fog">
            Request a wallet attestation.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-fog-muted md:text-lg">
            Connect Freighter or paste a Stellar G-address to run the full
            scoring flow: ingestion, scoring, proof generation, and on-chain
            attestation.
          </p>
        </div>

        <TryAttestation walletAddress={walletAddress} onWalletConnected={onWalletConnected} />
      </div>
    </section>
  );
}
