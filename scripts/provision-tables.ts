/**
 * Provisions tables and mints their QR tokens, then writes a printable sheet.
 *
 *   npm run qr:provision -- --tables templates/tables.csv --out .local/qr
 *
 * The raw token is shown exactly once, here, because Firestore stores only its
 * SHA-256 hash. The output directory holds live table credentials: it is
 * gitignored, and the printed labels should be treated like keys to the tables.
 */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {randomBytes, createHash} from 'node:crypto';
import {join} from 'node:path';
import QRCode from 'qrcode';
import {restaurant, requireConfirmation, PROJECT_ID, RESTAURANT_ID, BASE_URL, usingEmulator} from './admin-app';
import {parseCsv, parseBoolean} from './csv';

const mintToken = () => randomBytes(32).toString('base64url');
const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

type Args = {tables: string; out: string; rotate: boolean};

function parseArgs(argv: string[]): Args {
  const args: Args = {tables: 'templates/tables.csv', out: '.local/qr', rotate: false};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--tables') args.tables = argv[++i];
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--rotate') args.rotate = true;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  requireConfirmation('provision table QR tokens');
  console.log(`project=${PROJECT_ID} restaurant=${RESTAURANT_ID} emulator=${usingEmulator}`);

  const rows = parseCsv(readFileSync(args.tables, 'utf8'));
  if (!rows.length) throw new Error(`No table rows found in ${args.tables}`);

  mkdirSync(args.out, {recursive: true});
  const printable: {tableId: string; label: string; url: string}[] = [];

  for (const row of rows) {
    const tableId = row.tableId;
    if (!tableId) throw new Error('Table row is missing a tableId');
    const tableRef = restaurant().collection('tables').doc(tableId);
    const existing = await tableRef.get();
    const existingData = existing.data() as {qrTokenHash?: string; qrTokenVersion?: number} | undefined;

    // Without --rotate an already-provisioned table is left alone, so re-running
    // the script does not silently invalidate labels already stuck to tables.
    if (existingData?.qrTokenHash && !args.rotate) {
      console.log(`  ${tableId.padEnd(10)} already provisioned (v${existingData.qrTokenVersion ?? 1}) — skipped`);
      continue;
    }

    const token = mintToken();
    const tokenHash = hashToken(token);
    const version = (existingData?.qrTokenVersion ?? 0) + 1;

    await restaurant().firestore.runTransaction(async (tx) => {
      if (existingData?.qrTokenHash) {
        tx.set(
          restaurant().collection('qrTokens').doc(existingData.qrTokenHash),
          {revoked: true, revokedAt: new Date()},
          {merge: true},
        );
      }
      tx.set(restaurant().collection('qrTokens').doc(tokenHash), {
        tableId,
        version,
        revoked: false,
        createdAt: new Date(),
      });
      tx.set(
        tableRef,
        {
          label: row.label || tableId,
          enabled: parseBoolean(row.enabled, true),
          activeSessionId: existingData ? undefined : null,
          qrTokenHash: tokenHash,
          qrTokenVersion: version,
          qrRotatedAt: new Date(),
        },
        {merge: true},
      );
    });

    const url = `${BASE_URL}/t/${token}`;
    await QRCode.toFile(join(args.out, `${tableId}.svg`), url, {type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 512});
    printable.push({tableId, label: row.label || tableId, url});
    console.log(`  ${tableId.padEnd(10)} v${version} provisioned`);
  }

  if (printable.length) {
    // One sheet of labels, sized for A4, for the print shop.
    const cards = printable
      .map(
        ({tableId, label}) => `  <figure class="card">
    <h2>${label}</h2>
    <img src="${tableId}.svg" alt="QR code for ${label}" />
    <figcaption>Scan to view the menu and order<br /><small>${tableId}</small></figcaption>
  </figure>`,
      )
      .join('\n');
    writeFileSync(
      join(args.out, 'qr-sheet.html'),
      `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Bukhara table QR labels</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Georgia, serif; color: #22201e; background: #faf5eb; }
  .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; }
  .card { border: 2px solid #602b35; border-radius: 6mm; padding: 8mm; text-align: center; break-inside: avoid; margin: 0; }
  .card h2 { margin: 0 0 4mm; color: #602b35; letter-spacing: .08em; text-transform: uppercase; font-size: 16pt; }
  .card img { width: 70mm; height: 70mm; }
  figcaption { margin-top: 4mm; font-size: 10pt; color: #6b655f; }
</style>
</head>
<body>
<h1>Bukhara Restaurant — table QR labels</h1>
<p><strong>Confidential.</strong> Each code grants menu access to its own table only. Replace a label by re-running provisioning with --rotate.</p>
<div class="sheet">
${cards}
</div>
</body>
</html>
`,
    );
    console.log(`\nWrote ${printable.length} QR label(s) and qr-sheet.html to ${args.out}`);
    console.log('That directory contains live table credentials — do not commit it.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
