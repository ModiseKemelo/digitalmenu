/**
 * Imports the approved menu from the CSV intake templates into Firestore.
 *
 *   npm run import:menu -- --categories templates/categories.csv \
 *                          --items templates/menu-items.csv [--publish]
 *
 * The importer never invents data. Prices come from the CSV as decimal BWP and
 * are stored as integer thebe. Items are imported unpublished unless the CSV
 * says otherwise, so nothing reaches guests before it is approved; --publish is
 * refused for any item without a photo path.
 */
import {readFileSync} from 'node:fs';
import {restaurant, requireConfirmation, PROJECT_ID, RESTAURANT_ID, usingEmulator} from './admin-app';
import {parseCsv, bwpToThebe, parseBoolean, parseList} from './csv';

type Args = {categories?: string; items?: string; publish: boolean; dryRun: boolean};

function parseArgs(argv: string[]): Args {
  const args: Args = {publish: false, dryRun: false};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--categories') args.categories = argv[++i];
    else if (flag === '--items') args.items = argv[++i];
    else if (flag === '--publish') args.publish = true;
    else if (flag === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.categories && !args.items) {
    console.error('Nothing to do. Pass --categories and/or --items with a CSV path.');
    process.exit(1);
  }
  if (!args.dryRun) requireConfirmation('import the menu');

  console.log(`project=${PROJECT_ID} restaurant=${RESTAURANT_ID} emulator=${usingEmulator} dryRun=${args.dryRun}`);

  if (args.categories) {
    const rows = parseCsv(readFileSync(args.categories, 'utf8'));
    const batch = restaurant().firestore.batch();
    for (const row of rows) {
      if (!row.id) throw new Error('Category row is missing an id');
      batch.set(
        restaurant().collection('categories').doc(row.id),
        {
          name: row.name,
          sortOrder: Number(row.sortOrder || 0),
          published: args.publish ? true : parseBoolean(row.published),
          coverImagePath: row.coverImagePath || null,
          updatedAt: new Date(),
        },
        {merge: true},
      );
    }
    console.log(`categories: ${rows.length} row(s)`);
    if (!args.dryRun) await batch.commit();
  }

  if (args.items) {
    const rows = parseCsv(readFileSync(args.items, 'utf8'));
    const batch = restaurant().firestore.batch();
    for (const row of rows) {
      if (!row.id) throw new Error('Menu item row is missing an id');
      if (!row.categoryId) throw new Error(`Item ${row.id} is missing a categoryId`);

      const priceMinor = bwpToThebe(row.priceBWP);
      const published = args.publish ? true : parseBoolean(row.published);

      // Acceptance criterion 2: a published item must have an approved photo.
      if (published && !row.primaryImagePath) {
        throw new Error(`Item ${row.id} cannot be published without primaryImagePath (approved photograph)`);
      }

      batch.set(
        restaurant().collection('menuItems').doc(row.id),
        {
          categoryId: row.categoryId,
          name: row.name,
          description: row.description || '',
          priceMinor,
          available: parseBoolean(row.available, true),
          published,
          sortOrder: Number(row.sortOrder || 0),
          primaryImagePath: row.primaryImagePath || null,
          allergens: parseList(row.allergens || ''),
          // Options are maintained in the admin UI; the CSV seeds an empty set.
          options: [],
          notes: row.notes || '',
          updatedAt: new Date(),
        },
        {merge: true},
      );
      console.log(`  ${row.id.padEnd(24)} ${String(priceMinor).padStart(8)} thebe  published=${published}`);
    }
    console.log(`menu items: ${rows.length} row(s)`);
    if (!args.dryRun) await batch.commit();
  }

  console.log(args.dryRun ? 'Dry run complete; nothing was written.' : 'Import complete.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
