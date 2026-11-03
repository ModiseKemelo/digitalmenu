/**
 * Admin SDK bootstrap shared by the provisioning scripts.
 *
 * Against the emulator no credentials are needed. Against a real project the
 * script uses application default credentials, so no service-account key file
 * is ever read from or written to the repository.
 */
import {initializeApp, getApps, applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';

export const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'menu-bukhara';
export const RESTAURANT_ID = process.env.RESTAURANT_ID ?? process.env.NEXT_PUBLIC_RESTAURANT_ID ?? 'bukhara';
export const BASE_URL = process.env.PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

export const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (!getApps().length) {
  initializeApp(
    usingEmulator ? {projectId: PROJECT_ID} : {projectId: PROJECT_ID, credential: applicationDefault()},
  );
}

export const db = getFirestore();
export const auth = getAuth();
export const restaurant = () => db.collection('restaurants').doc(RESTAURANT_ID);

export function requireConfirmation(action: string): void {
  if (usingEmulator) return;
  if (process.env.I_UNDERSTAND_THIS_WRITES_TO_A_REAL_PROJECT === 'yes') return;
  console.error(
    `Refusing to ${action} against live project "${PROJECT_ID}".\n` +
      'Either export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 to target the emulator,\n' +
      'or set I_UNDERSTAND_THIS_WRITES_TO_A_REAL_PROJECT=yes to proceed deliberately.',
  );
  process.exit(1);
}
