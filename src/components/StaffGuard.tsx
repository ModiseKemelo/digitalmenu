'use client';
/**
 * Staff screen guard.
 *
 * This only decides what to render. It is not a security boundary: every
 * privileged action re-checks the staff record and role on the server, because
 * UI-only role hiding is not authorization (docs/04).
 */
import {useEffect, useState, type ReactNode} from 'react';
import Link from 'next/link';
import {onAuthStateChanged, type User} from 'firebase/auth';
import {doc, getDoc} from 'firebase/firestore';
import {firebase, RESTAURANT_ID, isFirebaseConfigured} from '@/lib/firebase-client';
import type {StaffRole} from '@/lib/contracts';
import {Notice, Spinner} from './ui';

export type StaffProfile = {uid: string; name: string; role: StaffRole};

export default function StaffGuard({
  children,
  requireAdmin = false,
}: {
  children: (staff: StaffProfile) => ReactNode;
  requireAdmin?: boolean;
}) {
  const [state, setState] = useState<{status: 'loading' | 'anonymous' | 'denied' | 'ready'; staff?: StaffProfile}>({
    status: 'loading',
  });

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setState({status: 'denied'});
      return;
    }
    const {auth, db} = firebase();
    return onAuthStateChanged(auth, async (user: User | null) => {
      if (!user) {
        setState({status: 'anonymous'});
        return;
      }
      const snapshot = await getDoc(doc(db, `restaurants/${RESTAURANT_ID}/staff/${user.uid}`)).catch(() => null);
      const data = snapshot?.exists() ? snapshot.data() : null;
      if (!data || data.active !== true) {
        setState({status: 'denied'});
        return;
      }
      setState({
        status: 'ready',
        staff: {uid: user.uid, name: String(data.name ?? user.email ?? user.uid), role: data.role as StaffRole},
      });
    });
  }, []);

  if (state.status === 'loading') return <Spinner label="Checking your access" />;

  if (state.status === 'anonymous') {
    return (
      <Notice tone="warn">
        Please <Link href="/staff/login">sign in</Link> with your staff account.
      </Notice>
    );
  }

  if (state.status === 'denied') {
    return <Notice tone="error">This account does not have active staff access. Speak to your manager.</Notice>;
  }

  const staff = state.staff!;
  if (requireAdmin && staff.role !== 'admin') {
    return <Notice tone="error">This screen is for administrators only.</Notice>;
  }

  return <>{children(staff)}</>;
}
