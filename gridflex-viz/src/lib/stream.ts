// Pure helper — hex to RGBA conversion for deck.gl.

/** Convert a CSS hex like "#5cf2c8" to an RGBA tuple deck.gl can ingest. */
export function hexToRgba(
  hex: string,
  alpha = 235
): [number, number, number, number] {
  const m = hex.replace("#", "");
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [r, g, b, alpha];
}
