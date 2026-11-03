'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {LogIn} from 'lucide-react';
import {signInWithEmailAndPassword} from 'firebase/auth';
import {firebase, isFirebaseConfigured, isAppCheckMissing} from '@/lib/firebase-client';
import {Notice} from '@/components/ui';
import Brand from '@/components/Brand';

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
    <main className="login-shell">
      <section className="login-art">
        <Brand inverse />
        <div><p className="eyebrow">Evening service</p><h1>Beautiful service<br />begins here.</h1>
        <p>Manage tables, orders and guest requests from one calm, real-time workspace.</p></div>
        <small>Gaborone · Botswana</small>
      </section>

      <form className="login-form" onSubmit={submit}>
        <p className="ops-kicker">Staff access</p>
        <h2>Welcome back</h2>
        <p className="muted">Sign in with your restaurant credentials.</p>
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
          <LogIn size={17} strokeWidth={2} />
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="login-security">Staff activity is recorded for security and service quality.</p>
      </form>
    </main>
  );
}
