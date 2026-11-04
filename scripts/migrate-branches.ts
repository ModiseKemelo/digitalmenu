/**
 * Migrates the single-restaurant data model to the branch model.
 *
 * Two things sit in the way of a second branch:
 *
 *  1. QR tokens and guest capabilities are stored *inside* a restaurant
 *     (`restaurants/{r}/qrTokens/{hash}`), but both are looked up by hash
 *     alone. A guest scanning a printed code supplies only the token, so the
 *     server has no branch to scope the lookup to and would have to search
 *     every branch. Both collections move to the top level and carry a
 *     `branchId`, which keeps every already-printed /t/<token> URL working.
 *
 *  2. There is no record of what a branch *is*. A `branches/{id}` document is
 *     created for the existing restaurant so it can be listed, renamed and
 *     disabled like any other.
 *
 * The migration is additive and idempotent: it copies rather than moves, so
 * the old documents stay readable until the new code is deployed and verified.
 * Run it again after deploying to delete the originals with --cleanup.
 *
 * Usage:
 *   tsx scripts/migrate-branches.ts [--dry-run] [--cleanup]
 */
import {db, restaurant, RESTAURANT_ID, PROJECT_ID, requireConfirmation} from './admin-app';

const DEFAULT_BRANCH_NAME = process.env.BRANCH_NAME ?? 'Bukhara Main';
const BATCH_LIMIT = 400;

type Counts = {branches: number; qrTokens: number; capabilities: number; deleted: number};

/** Copies a hash-keyed collection to the top level, stamping it with its branch. */
async function liftCollection(name: string, branchId: string, dryRun: boolean): Promise<number> {
  const source = await restaurant().collection(name).get();
  if (source.empty) return 0;

  let written = 0;
  for (let index = 0; index < source.docs.length; index += BATCH_LIMIT) {
    const slice = source.docs.slice(index, index + BATCH_LIMIT);
    const batch = db.batch();
    for (const document of slice) {
      // The hash is the document id and must be preserved exactly: it is what
      // a scanned token is matched against.
      batch.set(db.collection(name).doc(document.id), {...document.data(), branchId}, {merge: true});
      written += 1;
    }
    if (!dryRun) await batch.commit();
  }
  return written;
}

async function deleteCollection(name: string, dryRun: boolean): Promise<number> {
  const source = await restaurant().collection(name).get();
  let deleted = 0;
  for (let index = 0; index < source.docs.length; index += BATCH_LIMIT) {
    const slice = source.docs.slice(index, index + BATCH_LIMIT);
    const batch = db.batch();
    for (const document of slice) {
      batch.delete(document.ref);
      deleted += 1;
    }
    if (!dryRun) await batch.commit();
  }
  return deleted;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const cleanup = process.argv.includes('--cleanup');
  if (!dryRun) requireConfirmation('migrate the data model to branches');

  console.log(`project=${PROJECT_ID} branch=${RESTAURANT_ID} dryRun=${dryRun} cleanup=${cleanup}`);

  const counts: Counts = {branches: 0, qrTokens: 0, capabilities: 0, deleted: 0};

  // The branch record. Written with merge so re-running never clobbers a name
  // an administrator has since edited.
  const existing = await restaurant().get();
  const branchRef = db.collection('branches').doc(RESTAURANT_ID);
  const branchSnapshot = await branchRef.get();
  if (!branchSnapshot.exists) {
    if (!dryRun) {
      await branchRef.set({
        name: (existing.data()?.name as string | undefined) ?? DEFAULT_BRANCH_NAME,
        slug: RESTAURANT_ID,
        enabled: true,
        isDefault: true,
        createdAt: new Date(),
      });
    }
    counts.branches = 1;
  }

  counts.qrTokens = await liftCollection('qrTokens', RESTAURANT_ID, dryRun);
  counts.capabilities = await liftCollection('guestCapabilities', RESTAURANT_ID, dryRun);

  if (cleanup) {
    // Only safe once the branch-aware functions are deployed and a scan has
    // been verified against the top-level lookup.
    counts.deleted += await deleteCollection('qrTokens', dryRun);
    counts.deleted += await deleteCollection('guestCapabilities', dryRun);
  }

  console.log(
    `branches=${counts.branches} qrTokens=${counts.qrTokens} capabilities=${counts.capabilities} deleted=${counts.deleted}`,
  );
  if (dryRun) console.log('Dry run: nothing was written.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
