'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {signInWithEmailAndPassword} from 'firebase/auth';
import {firebase, isFirebaseConfigured, isAppCheckMissing} from '@/lib/firebase-client';
import {Notice} from '@/components/ui';

export default function StaffLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isFirebaseConfigured || isAppCheckMissing) {
      setError('This app is not configured yet. See docs/11-FIREBASE-SETUP.md.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(firebase().auth, email.trim(), password);
      router.replace('/staff');
    } catch {
      // Deliberately vague: it must not reveal whether an account exists.
      setError('That email address and password did not match a staff account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Bukhara Restaurant</p>
        <h1 style={{margin: '8px 0 0', fontSize: 26}}>Staff sign-in</h1>
      </header>

      <form className="card stack" style={{padding: 18, marginTop: 20}} onSubmit={submit}>
        <div>
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
