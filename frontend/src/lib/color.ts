const INK = '#171B24';
const WHITE = '#FFFFFF';

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

// relativeLuminance follows WCAG 2.x.
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// readableOn picks ink or white text, whichever contrasts more with bg.
export function readableOn(bg: string): string {
  return contrastRatio(bg, INK) >= contrastRatio(bg, WHITE) ? INK : WHITE;
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ensureContrast moves fg toward `toward` until it reaches the target
// contrast ratio against bg (WCAG AA for body text is 4.5).
export function ensureContrast(fg: string, bg: string, toward: string, target = 4.5): string {
  for (let t = 0; t <= 1; t += 0.02) {
    const c = mix(fg, toward, t);
    if (contrastRatio(c, bg) >= target) return c;
  }
  return toward;
}

// Link colors from the design system for the default violet; derived with
// the same contrast guarantee for any other primary color.
export const DEFAULT_PRIMARY = '#8B7CF6';

export function linkColors(primary: string): { light: string; dark: string } {
  if (primary.toUpperCase() === DEFAULT_PRIMARY) return { light: '#5845B8', dark: '#B6AAFF' };
  return {
    light: ensureContrast(primary, '#FFFFFF', INK, 5.5),
    dark: ensureContrast(primary, '#222834', WHITE, 6),
  };
}
