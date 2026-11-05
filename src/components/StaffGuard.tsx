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
import {firebase, isFirebaseConfigured} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import type {StaffRole} from '@/lib/contracts';
import {Notice, PageLoader} from './ui';

export type StaffProfile = {uid: string; name: string; role: StaffRole};

/**
 * What the loader says while the staff record is being read.
 *
 * It used to say "Checking your access / Confirming your staff record and
 * role". That describes our authorization check, which is our concern and not
 * the waiting person's: a waiter who taps Service calls mid-service wants to
 * know the service calls are coming, not that a role lookup is in flight. So
 * each screen names what is about to appear.
 *
 * Longest paths first: /admin would otherwise swallow /admin/menu.
 */
const SCREEN_LOADERS: {path: string; label: string; hint: string}[] = [
  {path: '/staff/requests', label: 'Opening service calls', hint: 'Guests asking for the bill, or for help.'},
  {path: '/staff/order/new', label: 'Opening the order pad', hint: 'Choose a table, then take the order.'},
  {path: '/staff/scan', label: 'Opening the dining room', hint: 'Every table, and which ones are seated.'},
  {path: '/staff/tables', label: 'Opening the table', hint: 'Its orders, payments and running bill.'},
  {path: '/admin/branches', label: 'Opening your locations', hint: 'Each branch, with its own dining room and menu.'},
  {path: '/admin/reports', label: 'Opening reports', hint: 'Sales, service speed and what is still owed.'},
  {path: '/admin/settings', label: 'Opening settings', hint: 'This location\u2019s profile and the audit trail.'},
  {path: '/admin/tables', label: 'Opening tables and QR codes', hint: 'Table access and the codes printed for them.'},
  {path: '/admin/media', label: 'Opening the media library', hint: 'Which dishes a guest sees a photograph of.'},
  {path: '/admin/staff', label: 'Opening the team', hint: 'Who may sign in, and what they may do.'},
  {path: '/admin/menu', label: 'Opening the menu', hint: 'Dishes, prices and what is on tonight.'},
  {path: '/admin', label: 'Opening administration', hint: 'The dining room, the menu and the team.'},
  {path: '/staff', label: 'Opening the order board', hint: 'Tonight\u2019s orders, as they arrive.'},
];

export function screenLoader(pathname: string): {label: string; hint: string} {
  const match = SCREEN_LOADERS.find(
    (screen) => pathname === screen.path || pathname.startsWith(`${screen.path}/`),
  );
  return match ?? {label: 'Opening the service console', hint: 'One moment while your screen is prepared.'};
}

export default function StaffGuard({
  children,
  requireAdmin = false,
}: {
  children: (staff: StaffProfile) => ReactNode;
  requireAdmin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Staff membership is held per location, so which location is selected
  // decides which record is read — and therefore what this person may do.
  const branchId = useBranchId();
  const [state, setState] = useState<{status: 'loading' | 'anonymous' | 'denied' | 'ready'; staff?: StaffProfile}>({
    status: 'loading',
  });

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setState({status: 'denied'});
      return;
    }
    // Switching location re-asks the question; showing the previous location's
    // answer while the new one is read would flash access that may not exist.
    setState({status: 'loading'});
    const {auth, db} = firebase();
    return onAuthStateChanged(auth, async (user: User | null) => {
      if (!user) {
        setState({status: 'anonymous'});
        return;
      }
      const snapshot = await getDoc(doc(db, `${branchPath(branchId)}/staff/${user.uid}`)).catch(() => null);
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
  }, [branchId]);

  if (state.status === 'loading') {
    const {label, hint} = screenLoader(pathname);
    return <PageLoader label={label} hint={hint} />;
  }

  if (state.status === 'anonymous') {
    return <SendToLogin pathname={pathname} router={router} />;
  }

  if (state.status === 'denied') {
    return (
      <Notice tone="error">
        This account has no active staff access at the selected location. If you work somewhere else, switch
        location in the header; otherwise speak to your manager.
      </Notice>
    );
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
