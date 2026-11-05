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
import {usePathname, useRouter} from 'next/navigation';
import {onAuthStateChanged, type User} from 'firebase/auth';
import {doc, getDoc} from 'firebase/firestore';
import {firebase, RESTAURANT_ID, isFirebaseConfigured} from '@/lib/firebase-client';
import type {StaffRole} from '@/lib/contracts';
import {Notice, PageLoader} from './ui';

export type StaffProfile = {uid: string; name: string; role: StaffRole};

export default function StaffGuard({
  children,
  requireAdmin = false,
}: {
  children: (staff: StaffProfile) => ReactNode;
  requireAdmin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
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

  if (state.status === 'loading')
    return <PageLoader label="Checking your access" hint="Confirming your staff record and role." />;

  if (state.status === 'anonymous') {
    return <SendToLogin pathname={pathname} router={router} />;
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

/**
 * A signed-out staff member used to get a notice with a link, which on a phone
 * mid-service means reading, tapping, signing in and then navigating back to
 * where they were. This sends them straight to sign-in and remembers the
 * destination so they land back on the screen they opened.
 */
function SendToLogin({
  pathname,
  router,
}: {
  pathname: string;
  router: ReturnType<typeof useRouter>;
}) {
  useEffect(() => {
    router.replace(`/staff/login?next=${encodeURIComponent(pathname)}`);
  }, [pathname, router]);

  return (
    <Notice tone="warn">
      Please <Link href={`/staff/login?next=${encodeURIComponent(pathname)}`}>sign in</Link> with your staff account.
    </Notice>
  );
}
