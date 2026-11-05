/**
 * Money entry for the administration screens.
 *
 * Prices are stored as an integer count of thebe. A float never touches a
 * price: `12.34 * 100` is 1233.9999999999998, and a menu that quietly loses a
 * thebe per edit is a menu nobody can reconcile. Parsing is done on the digits
 * of the string instead.
 */
export function minorToInput(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** Returns null when the text is not a well-formed amount. */
export function inputToMinor(value: string): number | null {
  const text = value.trim().replace(/,/g, '');
  if (!/^-?\d*(\.\d{0,2})?$/.test(text) || text === '' || text === '-' || text === '.') return null;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const minor = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** A URL-safe document id derived from a name, for new menu records. */
export function slugify(value: string, fallback = 'item'): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}
