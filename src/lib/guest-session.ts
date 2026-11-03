'use client';
/**
 * Guest capability storage.
 *
 * The capability lives in sessionStorage, not localStorage: closing the tab
 * should end the guest's access, and a capability must not outlive the dining
 * session on a shared or borrowed phone (docs/04).
 */
import {GUEST_CAPABILITY_TTL_MS} from './contracts';

const KEY = 'bukhara.guest';

export type GuestSession = {capability: string; sessionId: string; tableLabel: string; expiresAt: number};

export function readGuestSession(): GuestSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as GuestSession;
    // Expire locally as well, so the UI does not offer actions the server will refuse.
    if (!session.capability || session.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return session;
  } catch {
    window.sessionStorage.removeItem(KEY);
    return null;
  }
}

export function writeGuestSession(session: GuestSession): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function clearGuestSession(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(KEY);
}

export const CAPABILITY_TTL_MS = GUEST_CAPABILITY_TTL_MS;
