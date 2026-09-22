/**
 * TrailCast brand marks, drawn from the v0.1 brand sheet.
 *
 * `Logo` is the "switchback peak": a peak with a switchback trail climbing it
 * and the sun rising behind, on a Pine disc. `Wordmark` sets TRAILCAST in Big
 * Shoulders with the A drawn as a peak whose crossbar is Ember.
 */

export function Logo({ size = 32, title = "TrailCast" }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <circle cx="32" cy="32" r="32" fill="#1F3A2E" />
      <circle cx="44.5" cy="20.5" r="7" fill="#C8561E" />
      <path d="M8 49 L26 22 L33 32 L39 24 L56 49 Z" fill="#F2EDE3" />
      <path d="M26 22 L22.5 27.5 L26 26.5 L29.5 27.5 Z" fill="#CFC4AE" />
      {[
        [27, 28.5],
        [29, 31],
        [26.2, 33.4],
        [24.2, 36],
        [26.6, 38.4],
        [24.4, 41],
        [22, 43.6],
        [20.4, 46.4],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.35" fill="#C8561E" />
      ))}
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`wordmark ${className ?? ""}`} aria-label="TrailCast">
      <span aria-hidden>TR</span>
      <span className="wordmark-a" aria-hidden>
        A
      </span>
      <span aria-hidden>ILCAST</span>
    </span>
  );
}

/** A small scene for the top of a place's detail: ridges and a sun. */
export function Hero({ tone = "#C8561E" }: { tone?: string }) {
  return (
    <svg className="detail-hero" viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <rect width="400" height="120" fill="var(--hero-sky)" />
      <circle cx="300" cy="42" r="20" fill={tone} opacity="0.9" />
      <path d="M0 96 L70 40 L112 70 L170 26 L236 84 L290 52 L346 88 L400 60 L400 120 L0 120 Z" fill="var(--hero-far)" />
      <path d="M170 26 L158 36 L170 33 L182 36 Z" fill="#F2EDE3" opacity="0.85" />
      <path d="M0 110 L60 78 L128 100 L200 66 L262 98 L330 74 L400 104 L400 120 L0 120 Z" fill="var(--hero-near)" />
    </svg>
  );
}
