/**
 * Money entry is the one place an administration screen can quietly lose
 * money, so it is tested on its own.
 */
import {describe, it, expect} from 'vitest';
import {inputToMinor, minorToInput, slugify} from './admin-format';

describe('inputToMinor', () => {
  it('reads whole pula', () => {
    expect(inputToMinor('125')).toBe(12500);
  });

  it('reads pula and thebe', () => {
    expect(inputToMinor('125.50')).toBe(12550);
    expect(inputToMinor('0.05')).toBe(5);
  });

  it('pads a single decimal place, so 12.5 is twelve fifty and not twelve oh five', () => {
    expect(inputToMinor('12.5')).toBe(1250);
  });

  it('does not lose a thebe to floating point', () => {
    // 12.34 * 100 is 1233.9999999999998 in IEEE 754; the parser works on digits.
    expect(inputToMinor('12.34')).toBe(1234);
    expect(inputToMinor('1.15')).toBe(115);
    expect(inputToMinor('8.07')).toBe(807);
  });

  it('accepts a negative amount, for an option that makes a dish cheaper', () => {
    expect(inputToMinor('-15.00')).toBe(-1500);
  });

  it('tolerates thousands separators and surrounding space', () => {
    expect(inputToMinor(' 1,250.00 ')).toBe(125000);
    // Separators are stripped before validation, so a trailing one is simply
    // ignored rather than rejected mid-typing.
    expect(inputToMinor('12,')).toBe(1200);
  });

  it('refuses anything that is not an amount', () => {
    for (const bad of ['', ' ', '.', '-', 'abc', '12.345', '1.2.3', '1e3', '12.3.4', '--5']) {
      expect(inputToMinor(bad), bad).toBeNull();
    }
  });
});

describe('minorToInput', () => {
  it('always shows two decimal places', () => {
    expect(minorToInput(12500)).toBe('125.00');
    expect(minorToInput(5)).toBe('0.05');
    expect(minorToInput(0)).toBe('0.00');
  });

  it('keeps the sign of a negative delta', () => {
    expect(minorToInput(-1500)).toBe('-15.00');
  });

  it('round-trips through inputToMinor', () => {
    for (const minor of [0, 1, 99, 100, 12345, -250, 10_000_00]) {
      expect(inputToMinor(minorToInput(minor))).toBe(minor);
    }
  });
});

describe('slugify', () => {
  it('produces a URL-safe document id', () => {
    expect(slugify('Chicken Tikka Masala')).toBe('chicken-tikka-masala');
    expect(slugify('Veg  Paneer — Sizzler!')).toBe('veg-paneer-sizzler');
  });

  it('falls back when a name has nothing usable in it', () => {
    expect(slugify('***', 'dish')).toBe('dish');
  });

  it('stays within the identifier length the contracts allow', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});
