/** The FRANKENRUN wordmark: two halves stitched together, with a monster eye above the seam. */
export function Logo() {
  const stitches = Array.from({ length: 8 }, (_, i) => 60 + i * 15);
  return (
    <svg className="logo" viewBox="0 0 620 200" role="img" aria-label="Frankenrun">
      <title>Frankenrun</title>
      <g className="logo-text">
        <text className="logo-a" x="14" y="168" fontSize="116" textLength="388" lengthAdjust="spacingAndGlyphs">
          FRANKEN
        </text>
        <text className="logo-b" x="446" y="168" fontSize="116" textLength="160" lengthAdjust="spacingAndGlyphs">
          RUN
        </text>
      </g>
      <g className="logo-seam">
        <line x1="424" y1="52" x2="424" y2="176" />
        {stitches.map((y) => (
          <path key={y} d={`M416 ${y - 5} L432 ${y + 5} M432 ${y - 5} L416 ${y + 5}`} />
        ))}
      </g>
      <g className="logo-bolt" transform="translate(2 96)">
        <rect x="0" y="0" width="9" height="30" rx="2" />
        <rect x="-4" y="6" width="17" height="5" rx="2" />
      </g>
      <g className="logo-bolt" transform="translate(609 96)">
        <rect x="0" y="0" width="9" height="30" rx="2" />
        <rect x="-4" y="6" width="17" height="5" rx="2" />
      </g>
      <g className="logo-eye" transform="translate(424 34) scale(1.3)">
        <circle className="eye-white" r="27" />
        <path className="eye-veins" d="M-24 -6 L-14 -3 M-25 6 L-15 3 M24 -8 L14 -4 M22 9 L13 5 M-6 -26 L-4 -17 M8 -26 L5 -17" />
        <g className="eye-look">
          <circle className="eye-iris" r="13" />
          <circle className="eye-pupil" r="6.5" />
          <circle className="eye-glint" cx="-4" cy="-5" r="2.6" />
        </g>
        <path className="eye-lid" d="M-27 0 A27 27 0 0 1 27 0" />
      </g>
    </svg>
  );
}

/** A glowing jack-o'-lantern with ghost lights circling it: the loading spinner. */
export function PumpkinSpinner() {
  return (
    <div className="pumpkin-spinner" role="status" aria-label="Loading">
      <div className="pumpkin-orbit">
        <i />
        <i />
        <i />
      </div>
      <svg viewBox="0 0 100 100" className="pumpkin">
        <path className="pk-stem" d="M46 22 C46 12 52 8 60 8 C58 14 56 18 56 24 Z" />
        <ellipse className="pk-side" cx="30" cy="58" rx="22" ry="30" />
        <ellipse className="pk-side" cx="70" cy="58" rx="22" ry="30" />
        <ellipse className="pk-mid" cx="50" cy="58" rx="22" ry="32" />
        <path className="pk-eye" d="M33 48 L45 48 L39 38 Z" />
        <path className="pk-eye" d="M55 48 L67 48 L61 38 Z" />
        <path className="pk-mouth" d="M32 66 L40 62 L45 70 L50 62 L55 70 L60 62 L68 66 L62 78 L50 74 L38 78 Z" />
      </svg>
    </div>
  );
}
