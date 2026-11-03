'use client';
/**
 * Browser Firebase client. Only public web configuration belongs here; private
 * credentials must never be exposed through a NEXT_PUBLIC_ variable.
 */
import {getApps, initializeApp, getApp, type FirebaseApp} from 'firebase/app';
import {getAuth, connectAuthEmulator, type Auth} from 'firebase/auth';
import {getFirestore, connectFirestoreEmulator, type Firestore} from 'firebase/firestore';
import {getFunctions, connectFunctionsEmulator, type Functions} from 'firebase/functions';
import {getStorage, connectStorageEmulator, type FirebaseStorage} from 'firebase/storage';
import {initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider} from 'firebase/app-check';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const RESTAURANT_ID = process.env.NEXT_PUBLIC_RESTAURANT_ID ?? 'bukhara';
const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

/**
 * App Check site key. The callables set `enforceAppCheck: true` whenever they
 * are not running under the emulator, so against a live project this key is
 * required: without it every call is rejected before it reaches our code.
 *
 * `menu-bukhara` is registered with the **reCAPTCHA Enterprise** provider, so
 * that is the default. The provider must match what is registered in the
 * console, or attestation fails with no useful error in the browser.
 */
const appCheckSiteKey = process.env.NEXT_PUBLIC_APP_CHECK_SITE_KEY;
const appCheckProvider = process.env.NEXT_PUBLIC_APP_CHECK_PROVIDER ?? 'enterprise';

/** Must match REGION in functions/src/runtime.ts, or every call 404s. */
const FUNCTIONS_REGION = process.env.NEXT_PUBLIC_FUNCTIONS_REGION ?? 'africa-south1';

/** True when the live project is reachable but App Check would reject us. */
export const isAppCheckMissing = !useEmulators && !appCheckSiteKey;

/** Whether the app has enough configuration to talk to Firebase at all. */
export const isFirebaseConfigured = Boolean(config.projectId && (config.apiKey || useEmulators));

let cached: {app: FirebaseApp; auth: Auth; db: Firestore; functions: Functions; storage: FirebaseStorage} | null = null;

/**
 * Lazily initialises Firebase. Deliberately not a module-level singleton: the
 * preview pages must render without credentials, so nothing may throw at import
 * time.
 */
export function firebase() {
  if (cached) return cached;
  if (!isFirebaseConfigured) throw new Error('Firebase is not configured; see .env.example');

  const app = getApps().length ? getApp() : initializeApp(config);

  // Must run before the first callable so a token is attached to it. Skipped
  // under the emulator, where the functions do not enforce App Check.
  if (!useEmulators && appCheckSiteKey) {
    const debugToken = process.env.NEXT_PUBLIC_APP_CHECK_DEBUG_TOKEN;
    if (debugToken) {
      // Registered debug tokens let a developer machine call a live project.
      (globalThis as {FIREBASE_APPCHECK_DEBUG_TOKEN?: string}).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    }
    initializeAppCheck(app, {
      provider:
        appCheckProvider === 'v3'
          ? new ReCaptchaV3Provider(appCheckSiteKey)
          : new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const storage = getStorage(app);

  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9100', {disableWarnings: true});
    connectFirestoreEmulator(db, '127.0.0.1', 8085);
    connectFunctionsEmulator(functions, '127.0.0.1', 5002);
    connectStorageEmulator(storage, '127.0.0.1', 9198);
  }

  cached = {app, auth, db, functions, storage};
  return cached;
}
