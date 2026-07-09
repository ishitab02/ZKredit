import OnChainAttest from "../components/OnChainAttest";

export default function AttestationPage({
  walletAddress,
  onWalletConnected,
}: {
  walletAddress?: string | null;
  onWalletConnected?: (address: string) => void;
}) {
  return (
    <section
      className="attest-artifact-font relative overflow-hidden pt-28 pb-24 md:pt-32 md:pb-36"
      style={{
        backgroundImage:
          "radial-gradient(52vmax 42vmax at 84% -6%, rgba(0,167,155,0.16), transparent 60%)," +
          "radial-gradient(46vmax 40vmax at 4% 8%, rgba(250,209,255,0.07), transparent 62%)," +
          "radial-gradient(60vmax 50vmax at 50% 118%, rgba(233,206,158,0.08), transparent 64%)",
      }}
    >
      <div aria-hidden className="absolute inset-0 bg-dotgrid opacity-20" />
      <div className="relative z-10 mx-auto w-full max-w-[1080px] px-6 md:px-7">
        {/* Left-aligned hero, matching the design guide. */}
        <p className="eyebrow mb-5" style={{ color: "#E9CE9E" }}>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "#E9CE9E", boxShadow: "0 0 9px #E9CE9E" }}
          />
          Attestation
        </p>
        <h1 className="font-display text-display-md font-semibold leading-[0.95] text-fog">
          Your standing,
          <br />
          <span className="text-fog-muted">privately proven</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-fog-muted md:text-lg">
          Connect your Stellar wallet to issue a portable risk credential
        </p>

        <OnChainAttest walletAddress={walletAddress} onWalletConnected={onWalletConnected} />
      </div>
    </section>
  );
}
