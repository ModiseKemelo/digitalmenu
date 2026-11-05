'use client';
/**
 * Who is signed in, and how to stop being signed in.
 *
 * Until this existed the app had no sign-out at all. Staff share floor phones
 * and the till tablet, so without it one person's session simply passes to
 * whoever picks the device up next — and every privileged action that follows
 * is attributed in the audit trail to the person who walked away.
 *
 * It subscribes to auth itself rather than taking the profile from StaffGuard,
 * so it can render in the shell around screens that are still loading.
 */
import {useEffect, useState} from 'react';
import {useRouter} from 'next/navigation';
import {LogOut, UserRound} from 'lucide-react';
import {onAuthStateChanged, signOut, type User} from 'firebase/auth';
import {doc, getDoc} from 'firebase/firestore';
import {firebase, isFirebaseConfigured} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import type {StaffRole} from '@/lib/contracts';

type Who = {name: string; role: StaffRole | null; email: string};

export default function StaffAccountBar() {
  const router = useRouter();
  const branchId = useBranchId();
  const [who, setWho] = useState<Who | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const {auth, db} = firebase();
    return onAuthStateChanged(auth, async (user: User | null) => {
      if (!user) {
        setWho(null);
        return;
      }
      const snapshot = await getDoc(doc(db, `${branchPath(branchId)}/staff/${user.uid}`)).catch(() => null);
      const data = snapshot?.exists() ? snapshot.data() : null;
      setWho({
        name: String(data?.name ?? user.email ?? 'Signed in'),
        role: (data?.role as StaffRole | undefined) ?? null,
        email: user.email ?? '',
      });
    });
  }, [branchId]);

  const leave = async () => {
    setBusy(true);
    try {
      await signOut(firebase().auth);
      // replace, not push: the back button must not return to a staff screen
      // that is no longer authorized.
      router.replace('/staff/login');
    } finally {
      setBusy(false);
    }
  };

  if (!who) return null;

  return (
    <div className="ops-account">
      <span className="ops-account-avatar" aria-hidden><UserRound size={16} /></span>
      <span className="ops-account-who">
        <strong>{who.name}</strong>
        <small>{who.role ? (who.role === 'admin' ? 'Administrator' : 'Waiter') : who.email}</small>
      </span>
      <button type="button" className="ops-signout" onClick={() => void leave()} disabled={busy}>
        <LogOut size={15} />
        <span>{busy ? 'Signing out…' : 'Sign out'}</span>
      </button>
    </div>
  );
}
