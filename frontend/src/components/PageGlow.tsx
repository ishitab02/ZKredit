/** Ambient page background: 2–3 soft blobs that drift slowly, fixed behind all
 *  content so the whole page is lit consistently. */
export default function PageGlow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="glow blob-a -left-[10%] top-[2%] h-[66vmin] w-[66vmin]" />
      <div
        className="glow blob-b -right-[10%] top-[40%] h-[60vmin] w-[60vmin]"
        style={{
          background:
            "radial-gradient(circle, rgba(214,182,255,0.42) 0%, rgba(203,255,252,0.1) 45%, transparent 70%)",
        }}
      />
      <div className="glow blob-c left-1/2 bottom-[-10%] h-[72vmin] w-[88vmin]" />
    </div>
  );
}
