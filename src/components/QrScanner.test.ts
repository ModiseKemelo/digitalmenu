import {describe, it, expect} from 'vitest';
import {extractTableToken} from './QrScanner';

/**
 * Anyone can print a QR code and stick it on a table, so this function is a
 * security boundary: it must yield a token or nothing, never a destination.
 */
describe('extractTableToken', () => {
  const token = 'E_Xlds5TWBe-DPZG23cPGQyXxD6CDpUV-vwnMgQlpts';

  it('reads a token out of a table URL', () => {
    expect(extractTableToken(`https://menu-bukhara.web.app/t/${token}`)).toBe(token);
  });

  it('accepts a bare token', () => {
    expect(extractTableToken(token)).toBe(token);
  });

  it('ignores surrounding whitespace from a scan', () => {
    expect(extractTableToken(`  ${token}\n`)).toBe(token);
  });

  it('stops at a query string or fragment', () => {
    expect(extractTableToken(`https://menu-bukhara.web.app/t/${token}?utm=qr`)).toBe(token);
    expect(extractTableToken(`https://menu-bukhara.web.app/t/${token}#top`)).toBe(token);
    expect(extractTableToken(`https://menu-bukhara.web.app/t/${token}/`)).toBe(token);
  });

  // The decoded value is never navigated to directly. A hostile code names
  // another origin, and all this may do is hand back the token for our own
  // /t/ route — the host is discarded.
  it('takes only the token from a foreign origin, never the origin', () => {
    const extracted = extractTableToken(`https://evil.example.com/t/${token}`);
    expect(extracted).toBe(token);
    expect(extracted).not.toContain('evil');
  });

  it('rejects a code that is not a table code', () => {
    expect(extractTableToken('https://evil.example.com/phish')).toBeNull();
    expect(extractTableToken('javascript:alert(1)')).toBeNull();
    expect(extractTableToken('WIFI:S:Bukhara;T:WPA;P:hunter2;;')).toBeNull();
    expect(extractTableToken('')).toBeNull();
  });

  it('rejects a token outside the length the callable accepts', () => {
    expect(extractTableToken('short')).toBeNull();
    expect(extractTableToken('a'.repeat(257))).toBeNull();
  });

  it('rejects characters outside the URL-safe alphabet', () => {
    expect(extractTableToken('abcdefghijklmnop!')).toBeNull();
    expect(extractTableToken('abcdefghijklmnop/../etc')).toBeNull();
  });
});
