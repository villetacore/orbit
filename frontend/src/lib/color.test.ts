import { describe, expect, it } from 'vitest';
import { contrastRatio, isHexColor, linkColors, readableOn } from './color';

describe('color helpers', () => {
  it('validates hex colors', () => {
    expect(isHexColor('#B8EF65')).toBe(true);
    expect(isHexColor('B8EF65')).toBe(false);
    expect(isHexColor('#B8EF6')).toBe(false);
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('puts dark text on the lime accent and white text on dark colors', () => {
    expect(readableOn('#B8EF65')).toBe('#171B24');
    expect(readableOn('#171B24')).toBe('#FFFFFF');
    expect(readableOn('#3A2FB0')).toBe('#FFFFFF');
  });
});

describe('link colors', () => {
  it('uses the design system values for the default violet', () => {
    expect(linkColors('#8b7cf6')).toEqual({ light: '#5845B8', dark: '#B6AAFF' });
  });

  it('derives readable links for any primary color', () => {
    for (const c of ['#FFD400', '#00B3A4', '#1A1A1A', '#FF5A1F']) {
      const { light, dark } = linkColors(c);
      expect(contrastRatio(light, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark, '#222834')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
