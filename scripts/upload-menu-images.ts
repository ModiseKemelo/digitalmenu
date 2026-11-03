/**
 * Uploads menu photographs to Cloud Storage.
 *
 *   npm run seed:images -- --dir /path/to/images [--prefix menu]
 *
 * Each `<name>.jpg` in the directory is uploaded to `menu/seed/<name>.jpg` and
 * made publicly readable, because a menu photograph is public by nature and a
 * signed URL would expire mid-service. The resulting public URL is printed so
 * it can be pasted into the seed CSVs.
 *
 * This uploads a single size. Real menu photography should go through the
 * image variant pipeline (docs/08), not this script.
 */
import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {getStorage} from 'firebase-admin/storage';
import './admin-app';
import {requireConfirmation, PROJECT_ID} from './admin-app';

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET ?? `${PROJECT_ID}.firebasestorage.app`;
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dir = flag(argv, '--dir');
  const prefix = flag(argv, '--prefix') ?? 'menu';
  if (!dir) {
    console.error('Pass --dir <directory of .jpg files>');
    process.exit(1);
  }
  requireConfirmation('upload menu photographs');

  const bucket = getStorage().bucket(BUCKET);
  const files = readdirSync(dir).filter((f) => f.endsWith('.jpg') && statSync(join(dir, f)).isFile());
  if (!files.length) {
    console.error(`No .jpg files in ${dir}`);
    process.exit(1);
  }

  console.log(`bucket=${BUCKET} prefix=${prefix} files=${files.length}`);

  for (const file of files.sort()) {
    const destination = `${prefix}/${file}`;
    await bucket.upload(join(dir, file), {
      destination,
      metadata: {
        contentType: 'image/jpeg',
        // A menu photo changes rarely; let the CDN and the browser keep it.
        cacheControl: 'public, max-age=86400',
      },
    });
    await bucket.file(destination).makePublic();
    console.log(`  ${file.padEnd(22)} https://storage.googleapis.com/${BUCKET}/${destination}`);
  }

  console.log('Upload complete.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
