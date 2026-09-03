/**
 * Official Uy-Laurio brand marks.
 *
 * The artwork lives in `public/brand` and is generated from the logo file the
 * client supplied by `scripts/build-brand-assets.ps1` (white background removed).
 * Two tints exist because the mark sits on both light cards and the dark
 * navigation bar / maroon sign-in panel:
 *   - default  full-colour ink, for light surfaces
 *   - `light`  white ink, for dark surfaces
 */

const CREST = "/brand/uy-laurio-crest.png";
const CREST_LIGHT = "/brand/uy-laurio-crest-white.png";
const LOCKUP = "/brand/uy-laurio-lockup.png";
const LOCKUP_LIGHT = "/brand/uy-laurio-lockup-white.png";

/**
 * The crest on its own. `size` is the square footprint the mark is fitted
 * into, so swapping the artwork can never change surrounding layout.
 */
export function CrestMark({
  size = 80,
  light = false,
  className = "",
}: {
  size?: number;
  light?: boolean;
  className?: string;
}) {
  return (
    <img
      src={light ? CREST_LIGHT : CREST}
      alt="Uy-Laurio Legal & Notarial Services"
      width={size}
      height={size}
      draggable={false}
      className={`object-contain select-none shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Crest plus the "UY-LAURIO / LEGAL AND NOTARIAL SERVICES" wordmark. */
export function BrandLockup({
  width = 240,
  light = false,
  className = "",
}: {
  width?: number;
  light?: boolean;
  className?: string;
}) {
  return (
    <img
      src={light ? LOCKUP_LIGHT : LOCKUP}
      alt="Uy-Laurio Legal & Notarial Services"
      width={width}
      draggable={false}
      className={`object-contain select-none shrink-0 h-auto ${className}`}
      style={{ width }}
    />
  );
}
