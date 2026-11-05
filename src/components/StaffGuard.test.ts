/**
 * The guard's loader is matched by path prefix, and the order of that list is
 * load-bearing: '/admin' listed before '/admin/menu' would label every
 * administration screen "Opening administration". That is the kind of thing
 * nobody notices in review and everybody notices in service.
 */
import {describe, it, expect} from 'vitest';
import {screenLoader} from './StaffGuard';

describe('screenLoader', () => {
  it('names the screen being opened rather than the authorization check', () => {
    expect(screenLoader('/staff').label).toBe('Opening the order board');
    expect(screenLoader('/staff/requests').label).toBe('Opening service calls');
    expect(screenLoader('/admin/menu').label).toBe('Opening the menu');
  });

  it('does not let a shorter path swallow a longer one', () => {
    for (const path of [
      '/admin/menu',
      '/admin/media',
      '/admin/staff',
      '/admin/tables',
      '/admin/branches',
      '/admin/reports',
      '/admin/settings',
    ]) {
      expect(screenLoader(path).label, path).not.toBe('Opening administration');
    }
    for (const path of ['/staff/requests', '/staff/order/new', '/staff/scan', '/staff/tables/t1']) {
      expect(screenLoader(path).label, path).not.toBe('Opening the order board');
    }
  });

  it('matches a nested route through its section', () => {
    expect(screenLoader('/staff/tables/table-07').label).toBe('Opening the table');
    expect(screenLoader('/admin/menu/anything').label).toBe('Opening the menu');
  });

  it('does not match a path that merely begins with the same letters', () => {
    // '/adminx' is not inside '/admin'.
    expect(screenLoader('/adminx').label).toBe('Opening the service console');
    expect(screenLoader('/staffroom').label).toBe('Opening the service console');
  });

  it('falls back to something meaningful for an unknown screen', () => {
    const fallback = screenLoader('/somewhere/new');
    expect(fallback.label).toBe('Opening the service console');
    expect(fallback.hint).toBeTruthy();
  });

  it('gives every screen a hint, so the loader is never a bare word', () => {
    for (const path of ['/staff', '/admin', '/admin/reports', '/unknown']) {
      expect(screenLoader(path).hint.length, path).toBeGreaterThan(10);
    }
  });
});
