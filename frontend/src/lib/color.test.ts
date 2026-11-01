import { describe, expect, it } from 'vitest';
import { contrastRatio, isHexColor, readableOn } from './color';

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
