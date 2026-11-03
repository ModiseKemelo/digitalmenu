/**
 * Minimal RFC 4180 CSV reader. Written out rather than taken as a dependency
 * because the intake templates are small and fully under our control.
 */
export type Row = Record<string, string>;

export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') endField();
    else if (char === '\n') endRow();
    else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length) endRow();

  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((values) =>
    Object.fromEntries(header.map((key, index) => [key.trim(), (values[index] ?? '').trim()])),
  );
}

/**
 * Converts a decimal BWP price string to an integer count of thebe without
 * going through a float, so "125.10" can never become 12509.
 */
export function bwpToThebe(value: string): number {
  const trimmed = value.trim().replace(/^BWP\s*/i, '').replace(/,/g, '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) throw new Error(`Invalid BWP price: "${value}"`);
  const [, sign, whole, fraction = ''] = match;
  const thebe = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (sign === '-') throw new Error(`Price cannot be negative: "${value}"`);
  if (!Number.isSafeInteger(thebe)) throw new Error(`Price out of range: "${value}"`);
  return thebe;
}

export function parseBoolean(value: string, fallback = false): boolean {
  const normalised = value.trim().toLowerCase();
  if (normalised === '') return fallback;
  if (['true', 'yes', 'y', '1'].includes(normalised)) return true;
  if (['false', 'no', 'n', '0'].includes(normalised)) return false;
  throw new Error(`Invalid boolean: "${value}"`);
}

export function parseList(value: string): string[] {
  return value
    .split(/[;|]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
