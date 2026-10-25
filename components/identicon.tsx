// A deterministic, mirrored 5x5 avatar from a handle, in the neutral palette
// (colour stays reserved for verification state). Same handle, same face,
// everywhere - no uploads, no third-party avatar service.

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s.toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function Identicon({ seed, size = 40 }: { seed: string; size?: number }) {
  const h = hash(seed);
  const cells: [number, number][] = [];
  // 15 bits decide the left three columns; the right two mirror them.
  for (let i = 0; i < 15; i++) {
    if ((h >> i) & 1) {
      const x = Math.floor(i / 5);
      const y = i % 5;
      cells.push([x, y]);
      if (x < 2) cells.push([4 - x, y]);
    }
  }
  const tone = (h >> 15) & 1 ? "var(--ink)" : "var(--muted)";
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" className="rounded-[8px] bg-soft" aria-hidden="true">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" fill={tone} />
      ))}
    </svg>
  );
}
