import { describe, it, expect } from 'vitest';
import { emailToDocId, validateRate, validateEmail } from '../engineerRatesFirestore';

describe('emailToDocId', () => {
  it('replaces @ with _at_ and . with _', () => {
    expect(emailToDocId('anil@qualitastech.com')).toBe('anil_at_qualitastech_com');
  });

  it('lowercases', () => {
    expect(emailToDocId('Anil@Qualitastech.COM')).toBe('anil_at_qualitastech_com');
  });

  it('throws on non-qualitastech domain', () => {
    expect(() => emailToDocId('foo@gmail.com')).toThrow();
  });

  it('throws on empty input', () => {
    expect(() => emailToDocId('')).toThrow();
  });
});

describe('validateRate', () => {
  it('accepts non-negative finite numbers', () => {
    expect(validateRate(0)).toBe(true);
    expect(validateRate(1500)).toBe(true);
    expect(validateRate(0.5)).toBe(true);
  });

  it('rejects negative, NaN, and Infinity', () => {
    expect(validateRate(-1)).toBe(false);
    expect(validateRate(Number.NaN)).toBe(false);
    expect(validateRate(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('rejects non-numbers', () => {
    expect(validateRate('1500' as unknown as number)).toBe(false);
    expect(validateRate(null as unknown as number)).toBe(false);
    expect(validateRate(undefined as unknown as number)).toBe(false);
  });
});

describe('validateEmail', () => {
  it('accepts well-formed @qualitastech.com emails', () => {
    expect(validateEmail('rahul@qualitastech.com')).toBe(true);
    expect(validateEmail('first.last@qualitastech.com')).toBe(true);
  });

  it('rejects other domains', () => {
    expect(validateEmail('rahul@gmail.com')).toBe(false);
  });

  it('rejects malformed', () => {
    expect(validateEmail('not-an-email')).toBe(false);
    expect(validateEmail('@qualitastech.com')).toBe(false);
    expect(validateEmail('')).toBe(false);
  });
});
