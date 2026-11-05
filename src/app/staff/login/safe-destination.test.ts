import {describe, it, expect} from 'vitest';
import {safeDestination} from './page';

/**
 * The destination arrives in the URL, so anyone can put anything in it.
 * Redirecting staff off-site immediately after they have typed a password is
 * precisely the handoff a phishing flow wants, so only same-origin paths pass.
 */
describe('safeDestination', () => {
  it('keeps a same-origin path', () => {
    expect(safeDestination('/staff/requests')).toBe('/staff/requests');
    expect(safeDestination('/admin/tables')).toBe('/admin/tables');
  });

  it('falls back to the console when absent', () => {
    expect(safeDestination(null)).toBe('/staff');
    expect(safeDestination('')).toBe('/staff');
  });

  it('refuses an absolute URL to another origin', () => {
    expect(safeDestination('https://evil.example.com/login')).toBe('/staff');
    expect(safeDestination('http://evil.example.com')).toBe('/staff');
  });

  // "//host" is protocol-relative: the browser treats it as another origin
  // even though it starts with a slash.
  it('refuses a protocol-relative URL', () => {
    expect(safeDestination('//evil.example.com')).toBe('/staff');
    expect(safeDestination('//evil.example.com/staff')).toBe('/staff');
  });

  it('refuses a scheme that is not a path at all', () => {
    expect(safeDestination('javascript:alert(1)')).toBe('/staff');
    expect(safeDestination('data:text/html,<script>')).toBe('/staff');
  });
});
