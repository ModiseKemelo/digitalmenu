/**
 * Integration harness: drives the real callables against the emulator suite.
 *
 * These tests exercise the paths that unit tests cannot reach — transactions,
 * idempotency, authorization and the one-session-per-table invariant — which is
 * the evidence the runbook requires before ordering may be enabled.
 */
import {initializeApp, deleteApp, type FirebaseApp} from 'firebase/app';
import {getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, connectAuthEmulator, signOut} from 'firebase/auth';
import {getFunctions, httpsCallable, connectFunctionsEmulator} from 'firebase/functions';
import {REGION} from '../../functions/src/runtime-region';
import {initializeApp as initAdmin, deleteApp as deleteAdminApp, type App} from 'firebase-admin/app';
import {getFirestore, type Firestore, type CollectionReference} from 'firebase-admin/firestore';
import {createHash, randomBytes} from 'node:crypto';

export const PROJECT_ID = 'bukhara-emulator-test';
export const RESTAURANT_ID = 'bukhara';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9100';

let adminApp: App | undefined;
let clientApp: FirebaseApp | undefined;

export function admin(): Firestore {
  adminApp ??= initAdmin({projectId: PROJECT_ID}, `admin-${Date.now()}`);
  return getFirestore(adminApp);
}

export function restaurant() {
  return admin().collection('restaurants').doc(RESTAURANT_ID);
}

function client(): FirebaseApp {
  if (clientApp) return clientApp;
  clientApp = initializeApp({projectId: PROJECT_ID, apiKey: 'emulator-fake-key'}, `client-${Date.now()}`);
  connectAuthEmulator(getAuth(clientApp), 'http://127.0.0.1:9100', {disableWarnings: true});
  connectFunctionsEmulator(getFunctions(clientApp, REGION), '127.0.0.1', 5002);
  return clientApp;
}

/** Calls a callable as whoever is currently signed in (nobody, by default). */
export async function callFn<TInput, TResult>(name: string, data: TInput): Promise<TResult> {
  const callable = httpsCallable<TInput, TResult>(getFunctions(client(), REGION), name);
  return (await callable(data)).data;
}

export type CallFailure = {code: string; details?: {code?: string}; message: string};

/** Asserts a callable rejects, and returns the structured failure for inspection. */
export async function expectFailure<TInput>(name: string, data: TInput): Promise<CallFailure> {
  try {
    await callFn(name, data);
  } catch (error) {
    return error as CallFailure;
  }
  throw new Error(`Expected ${name} to fail, but it succeeded`);
}

/**
 * Signs in as a staff account, creating it on first use.
 *
 * The Auth emulator leaves the previously signed-in user in the SDK's memory.
 * Creating the next account makes the SDK reload that stale user, and the
 * emulator has often already invalidated its token — which surfaces as
 * `auth/user-token-expired` thrown from the *new* sign-in, failing whichever
 * test happened to run at that moment. Signing out first makes each sign-in
 * independent, and the retry covers the race that remains.
 */
export async function signInAs(email: string, password = 'emulator-password'): Promise<string> {
  const auth = getAuth(client());
  await signOut(auth).catch(() => undefined);

  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password).catch(() =>
        signInWithEmailAndPassword(auth, email, password),
      );
      return credential.user.uid;
    } catch (error) {
      const code = (error as {code?: string}).code;
      if (code !== 'auth/user-token-expired' || attempt === attempts) throw error;
      await signOut(auth).catch(() => undefined);
    }
  }
  throw new Error('unreachable');
}

export async function signOutStaff(): Promise<void> {
  await signOut(getAuth(client()));
}

/** Creates a staff record for a signed-in account. */
export async function makeStaff(uid: string, role: 'waiter' | 'admin', active = true): Promise<void> {
  await restaurant().collection('staff').doc(uid).set({name: `${role}-${uid.slice(0, 6)}`, role, active});
}

export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
export const mintToken = () => randomBytes(32).toString('base64url');

/** Seeds a table with a known QR token and returns the raw token. */
export async function seedTable(tableId: string, label = tableId, enabled = true): Promise<string> {
  const token = mintToken();
  const tokenHash = hashToken(token);
  // QR tokens are top level and carry their branch: a scan supplies the hash
  // alone, so there is no branch to scope the lookup to.
  await admin().collection('qrTokens').doc(tokenHash).set({branchId: RESTAURANT_ID, tableId, version: 1, revoked: false});
  await restaurant().collection('tables').doc(tableId).set({
    label,
    enabled,
    activeSessionId: null,
    qrTokenHash: tokenHash,
    qrTokenVersion: 1,
  });
  return token;
}

export async function seedMenuItem(
  id: string,
  overrides: Partial<{
    name: string;
    priceMinor: number;
    available: boolean;
    published: boolean;
    categoryId: string;
    options: {id: string; name: string; priceDeltaMinor: number; available?: boolean}[];
  }> = {},
): Promise<void> {
  await restaurant()
    .collection('menuItems')
    .doc(id)
    .set({
      name: overrides.name ?? `Item ${id}`,
      priceMinor: overrides.priceMinor ?? 12500,
      available: overrides.available ?? true,
      published: overrides.published ?? true,
      categoryId: overrides.categoryId ?? 'mains',
      sortOrder: 0,
      options: overrides.options ?? [],
      allergens: [],
    });
}

export const key = () => randomBytes(18).toString('base64url');

/**
 * Wipes the restaurant tree so suites do not leak state.
 *
 * Deliberately not `recursiveDelete`: against the emulator its BulkWriter
 * stalls once a few hundred documents have accumulated, which hung the suite.
 * Explicit batched deletes of the known collections are fast and deterministic.
 */
/** Collections under restaurants/{branchId}. */
const BRANCH_COLLECTIONS = [
  'menuItems',
  'categories',
  'menuOverrides',
  'tables',
  'serviceRequests',
  'staff',
];

/**
 * Collections at the database root. QR tokens and capabilities are keyed by
 * hash alone; the rest is bookkeeping whose keys already embed their owner.
 */
const ROOT_COLLECTIONS = ['qrTokens', 'guestCapabilities', 'idempotency', 'rateLimits', 'auditLogs', 'branches'];

const SESSION_SUBCOLLECTIONS = ['orders', 'payments', 'guestAccess'];

async function deleteCollection(ref: CollectionReference): Promise<void> {
  for (;;) {
    const snapshot = await ref.limit(300).get();
    if (snapshot.empty) return;
    const batch = admin().batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
    if (snapshot.size < 300) return;
  }
}

export async function resetRestaurant(): Promise<void> {
  const sessions = await restaurant().collection('sessions').get();
  for (const session of sessions.docs) {
    for (const name of SESSION_SUBCOLLECTIONS) {
      await deleteCollection(session.ref.collection(name));
    }
  }
  await deleteCollection(restaurant().collection('sessions'));
  for (const name of BRANCH_COLLECTIONS) {
    await deleteCollection(restaurant().collection(name));
  }
  for (const name of ROOT_COLLECTIONS) {
    await deleteCollection(admin().collection(name));
  }
}

export async function teardown(): Promise<void> {
  if (clientApp) await deleteApp(clientApp);
  if (adminApp) await deleteAdminApp(adminApp);
  clientApp = undefined;
  adminApp = undefined;
}
