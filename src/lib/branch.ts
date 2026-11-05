'use client';
/**
 * Which location the signed-in staff member is working at.
 *
 * This is a convenience, not a permission: every callable re-authorizes the
 * account against the branch id it is sent, and staff membership is held per
 * branch, so choosing one here can only ever narrow what the server already
 * allows. Choosing a branch somebody has no staff record in gets them a
 * refusal, not access.
 *
 * The selection lives in a module-level store rather than React context so the
 * picker in the page header and the screen below it stay in step without every
 * route having to be wrapped in a provider.
 */
import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {collection, getDocs} from 'firebase/firestore';
import {firebase, RESTAURANT_ID} from './firebase-client';

export type Branch = {id: string; name: string; city: string; enabled: boolean};

const STORAGE_KEY = 'bukhara.admin.branch';
const listeners = new Set<() => void>();

/** Cached so getSnapshot returns a stable value; React calls it on every render. */
let current: string | null = null;

function read(): string {
  if (current !== null) return current;
  try {
    current = window.localStorage.getItem(STORAGE_KEY) || RESTAURANT_ID;
  } catch {
    // Private browsing can throw on access alone.
    current = RESTAURANT_ID;
  }
  return current;
}

export function setBranchId(branchId: string): void {
  current = branchId;
  try {
    window.localStorage.setItem(STORAGE_KEY, branchId);
  } catch {
    // Losing the preference between visits is acceptable; losing the screen is not.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBranchId(): string {
  // The server has no localStorage, so it renders the founding branch and the
  // client reconciles on hydration.
  return useSyncExternalStore(subscribe, read, () => RESTAURANT_ID);
}

/**
 * The branches this account can see. `branches` is readable by any signed-in
 * user; what they may *do* in one is decided per call by their staff record
 * there.
 */
export function useBranches(): {branches: Branch[] | null; failed: boolean; reload: () => void} {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    getDocs(collection(firebase().db, 'branches'))
      .then((snapshot) => {
        if (!live) return;
        const rows = snapshot.docs.map((document) => {
          const data = document.data();
          return {
            id: document.id,
            name: String(data.name ?? document.id),
            city: String(data.city ?? ''),
            enabled: data.enabled !== false,
          };
        });
        // A deployment that predates the branch migration has no branches
        // document for the founding location, and an empty picker would make
        // the screens look broken. The founding branch always exists.
        if (!rows.some((row) => row.id === RESTAURANT_ID)) {
          rows.unshift({id: RESTAURANT_ID, name: 'Bukhara Gaborone', city: 'Gaborone', enabled: true});
        }
        rows.sort((a, b) => (a.id === RESTAURANT_ID ? -1 : b.id === RESTAURANT_ID ? 1 : a.name.localeCompare(b.name)));
        setBranches(rows);
      })
      .catch(() => {
        if (!live) return;
        setFailed(true);
        setBranches([{id: RESTAURANT_ID, name: 'Bukhara Gaborone', city: 'Gaborone', enabled: true}]);
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {branches, failed, reload};
}

/** Path prefix for direct Firestore reads scoped to the chosen branch. */
export function branchPath(branchId: string): string {
  return `restaurants/${branchId}`;
}
