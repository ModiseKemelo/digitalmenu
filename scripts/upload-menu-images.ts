/**
 * Uploads menu photographs to Cloud Storage.
 *
 *   npm run menu:images -- --dir /path/to/images [--prefix menu]
 *
 * Each `<name>.jpg` in the directory is uploaded to `<prefix>/<name>.jpg` and
 * made publicly readable, because a menu photograph is public by nature and a
 * signed URL would expire mid-service. The resulting public URL is printed so
 * it can be pasted into the seed CSVs, or into Media library on the admin
 * screens, which asks for exactly this URL.
 *
 * Each image is resized before upload. The Next.js image optimizer is off (see
 * next.config.ts), so whatever is uploaded is what a phone downloads; the
 * originals average ~290KB, which is far too heavy for a menu grid on mobile
 * data. This is still a single size — real menu photography should go through
 * the variant pipeline in docs/08, not this script.
 */
import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import sharp from 'sharp';
import {getStorage} from 'firebase-admin/storage';
import './admin-app';
import {requireConfirmation, PROJECT_ID} from './admin-app';

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET ?? `${PROJECT_ID}.firebasestorage.app`;
/** Wide enough for a full-bleed dish photo on a phone at 2x. */
const MAX_WIDTH = 900;

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
    const body = await sharp(join(dir, file))
      .rotate()                       // honour EXIF orientation before resizing
      .resize({width: MAX_WIDTH, withoutEnlargement: true})
      .jpeg({quality: 78, progressive: true, mozjpeg: true})
      .toBuffer();

    await bucket.file(destination).save(body, {
      contentType: 'image/jpeg',
      // A menu photo changes rarely; let the CDN and the browser keep it.
      metadata: {cacheControl: 'public, max-age=86400'},
    });
    await bucket.file(destination).makePublic();
    // Printed in full because this is the value pasted into Media library; a
    // bare filename would leave the operator assembling the URL by hand.
    const publicUrl = `https://storage.googleapis.com/${BUCKET}/${destination}`;
    console.log(`  ${file.padEnd(46)} ${String(Math.round(body.length / 1024)).padStart(4)}KB  ${publicUrl}`);
  }

  console.log('Upload complete.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
