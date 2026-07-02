import { useState } from "react";

/** Image with a graceful fallback (drop your asset at public/example.jpeg). */
export default function Placeholder({
  src = "/example.jpeg",
  alt,
  className = "",
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`relative flex items-center justify-center bg-gradient-to-br from-ink-600 via-ink-700 to-ink-800 ${className}`}
      >
        <span className="bg-dotgrid absolute inset-0 opacity-30" />
        <span className="relative font-mono text-xs uppercase tracking-[0.25em] text-fog-faint">
          example.jpeg
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}
