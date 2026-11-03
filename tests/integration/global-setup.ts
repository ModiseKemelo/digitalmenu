/**
 * Clears the restaurant tree once, before any integration file runs.
 *
 * Each file previously reset in its own `beforeAll`, which meant a second admin
 * client and a second wipe mid-run; against the emulator that intermittently
 * stalled for a minute. One reset up front is enough because every test owns a
 * distinct table id, staff account and guest capability.
 */
import {initializeApp, deleteApp} from 'firebase-admin/app';
import {getFirestore, type CollectionReference} from 'firebase-admin/firestore';

const PROJECT_ID = 'bukhara-emulator-test';
const RESTAURANT_ID = 'bukhara';

const COLLECTIONS = [
  'menuItems',
  'categories',
  'tables',
  'qrTokens',
  'guestCapabilities',
  'idempotency',
  'rateLimits',
  'serviceRequests',
  'auditLogs',
  'staff',
];
const SESSION_SUBCOLLECTIONS = ['orders', 'payments', 'guestAccess'];

export async function setup(): Promise<void> {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9100';

  const app = initializeApp({projectId: PROJECT_ID}, 'integration-global-setup');
  const db = getFirestore(app);
  const restaurant = db.collection('restaurants').doc(RESTAURANT_ID);

  const deleteCollection = async (ref: CollectionReference): Promise<void> => {
    for (;;) {
      const snapshot = await ref.limit(300).get();
      if (snapshot.empty) return;
      const batch = db.batch();
      for (const document of snapshot.docs) batch.delete(document.ref);
      await batch.commit();
      if (snapshot.size < 300) return;
    }
  };

  const sessions = await restaurant.collection('sessions').get();
  for (const session of sessions.docs) {
    for (const name of SESSION_SUBCOLLECTIONS) await deleteCollection(session.ref.collection(name));
  }
  await deleteCollection(restaurant.collection('sessions'));
  for (const name of COLLECTIONS) await deleteCollection(restaurant.collection(name));

  await deleteApp(app);
}
