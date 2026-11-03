/**
 * Removes menu documents that are no longer in the intake CSVs.
 *
 *   npm run menu:prune -- --categories data/categories.csv --items data/menu-items.csv [--dry-run]
 *
 * Importing is a merge, so a dish dropped from the menu would otherwise stay
 * published forever. This makes the CSVs authoritative: anything not listed in
 * them is deleted. It never touches orders, sessions or payments.
 */
import {readFileSync} from 'node:fs';
import {restaurant, requireConfirmation, PROJECT_ID, RESTAURANT_ID} from './admin-app';
import {parseCsv} from './csv';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function idsFrom(path: string | undefined): Set<string> | null {
  if (!path) return null;
  return new Set(parseCsv(readFileSync(path, 'utf8')).map((row) => row.id).filter(Boolean));
}

async function prune(collectionName: string, keep: Set<string> | null, dryRun: boolean): Promise<void> {
  if (!keep) return;
  const snapshot = await restaurant().collection(collectionName).get();
  const doomed = snapshot.docs.filter((doc) => !keep.has(doc.id));
  console.log(`${collectionName}: ${snapshot.size} in Firestore, ${keep.size} in the CSV, ${doomed.length} to delete`);
  for (const doc of doomed) console.log(`  - ${doc.id}`);
  if (dryRun || !doomed.length) return;

  // Firestore caps a batch at 500 writes.
  for (let i = 0; i < doomed.length; i += 400) {
    const batch = restaurant().firestore.batch();
    for (const doc of doomed.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
  console.log(`  deleted ${doomed.length}`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) requireConfirmation('delete menu documents');
  console.log(`project=${PROJECT_ID} restaurant=${RESTAURANT_ID} dryRun=${dryRun}`);

  await prune('menuItems', idsFrom(arg('--items')), dryRun);
  await prune('categories', idsFrom(arg('--categories')), dryRun);

  console.log(dryRun ? 'Dry run complete; nothing was deleted.' : 'Prune complete.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
