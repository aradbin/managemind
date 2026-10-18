// A QR code as inline SVG (lean-qr, about 4 KB gzipped), for authenticator
// setup and packing slips. Always dark on white with a quiet zone, so phones scan it in dark mode.
import { generate } from 'lean-qr';
import { toSvgPath } from 'lean-qr/extras/svg';
import { useMemo } from 'react';

const QUIET = 4;

export function QrCode({
  value,
  label,
  className = 'size-52',
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const code = useMemo(() => generate(value), [value]);
  const size = code.size + QUIET * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-QUIET} ${-QUIET} ${size} ${size}`}
      shapeRendering="crispEdges"
      className={`${className} rounded-md`}
    >
      <rect x={-QUIET} y={-QUIET} width={size} height={size} fill="#fff" />
      <path d={toSvgPath(code)} fill="#000" />
    </svg>
  );
}
