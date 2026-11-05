'use client';

import {Suspense, useEffect, useState} from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {Eye, EyeOff, LogIn} from 'lucide-react';
import {onAuthStateChanged, signInWithEmailAndPassword} from 'firebase/auth';
import {firebase, isFirebaseConfigured, isAppCheckMissing} from '@/lib/firebase-client';
import {Notice, PageLoader, Spinner} from '@/components/ui';
import Brand from '@/components/Brand';

/**
 * Only same-origin paths are honoured as a post-sign-in destination. The value
 * arrives in the URL, so anyone can put anything in it; sending staff to an
 * attacker's page immediately after they have typed a password is exactly the
 * handoff a phishing flow wants.
 */
export function safeDestination(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/staff';
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeDestination(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyIn, setAlreadyIn] = useState<boolean | null>(null);

  // Someone who is already signed in should not be asked to sign in again; it
  // reads as though their session was lost.
  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAlreadyIn(false);
      return;
    }
    return onAuthStateChanged(firebase().auth, (user) => {
      if (user) {
        setAlreadyIn(true);
        router.replace(next);
      } else {
        setAlreadyIn(false);
      }
    });
  }, [next, router]);

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
      router.replace(next);
    } catch (failure) {
      const code = (failure as {code?: string}).code ?? '';
      // Whether an account exists stays hidden. But a rate limit or a dead
      // connection is not a credential problem, and telling someone to check
      // their password when the real cause is no signal wastes a waiter's time
      // mid-service.
      if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Wait a minute before trying again, or ask your manager to reset your password.');
      } else if (code === 'auth/network-request-failed') {
        setError('No connection to the restaurant system. Check the Wi-Fi and try again.');
      } else {
        setError('That email address and password did not match a staff account.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (alreadyIn === null) {
    return (
      <div className="login-form">
        <PageLoader label="Just a moment" hint="Seeing whether you are already signed in." />
      </div>
    );
  }

  if (alreadyIn) {
    return (
      <div className="login-form">
        <Notice tone="ok">You are already signed in. Taking you to the service console…</Notice>
      </div>
    );
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <p className="ops-kicker">Staff access</p>
      <h2>Welcome back</h2>
      <p className="muted">Sign in with your restaurant credentials.</p>

      {next !== '/staff' && (
        <Notice>Sign in to continue to the screen you were opening.</Notice>
      )}

      <div>
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <div className="password-field">
          <input
            id="password"
            type={reveal ? 'text' : 'password'}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {/* Typing a password unseen on a phone keyboard, in a dim dining
              room, is the usual reason a correct password "fails". */}
          <button
            type="button"
            className="password-reveal"
            onClick={() => setReveal((on) => !on)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            aria-pressed={reveal}
          >
            {reveal ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <button type="submit" className="btn" disabled={busy}>
        <LogIn size={17} strokeWidth={2} />
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="login-security">Staff activity is recorded for security and service quality.</p>
    </form>
  );
}

export default function StaffLogin() {
  return (
    <main className="login-shell">
      <section className="login-art">
        <Brand inverse />
        <div><p className="eyebrow">Evening service</p><h1>Beautiful service<br />begins here.</h1>
        <p>Manage tables, orders and guest requests from one calm, real-time workspace.</p></div>
        <small>Gaborone · Botswana</small>
      </section>

      {/* useSearchParams needs a Suspense boundary to prerender this route. */}
      <Suspense fallback={<div className="login-form"><Spinner label="Preparing the sign-in" /></div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
