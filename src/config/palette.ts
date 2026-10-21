// Art direction palette (docs/art-direction.md). Do not add colors casually:
// the world is "light floating in a dark void" with three light colors.
export const PALETTE = {
  void: '#05060f', // deep indigo-black background
  voidDeep: '#020208',
  indigo: '#121a3a', // background glow tint
  cyan: '#3ff2ff', // player / left hand / "good"
  magenta: '#ff3fb4', // right hand / danger
  amber: '#ffb43f', // perfect / goal / reward
  white: '#f4f7ff',
} as const;

export type LightColor = 'cyan' | 'magenta' | 'amber';

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Palette colour in linear space (what shaders/additive blending work in). */
export function hexToLinear(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [toLin(r), toLin(g), toLin(b)];
}
