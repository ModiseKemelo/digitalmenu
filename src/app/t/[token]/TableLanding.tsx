'use client';

import {useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {api, ApiError} from '@/lib/api';
import {isFirebaseConfigured, isAppCheckMissing} from '@/lib/firebase-client';
import {writeGuestSession} from '@/lib/guest-session';
import {Notice, Spinner} from '@/components/ui';

/** Human wording for the server's structured QR failures. */
const MESSAGES: Record<string, string> = {
  'invalid-qr': 'This QR code is not valid. Please ask a member of staff for help.',
  'table-disabled': 'This table is not taking orders at the moment. Please speak to a member of staff.',
  'rate-limited': 'Too many attempts from this code. Please wait a moment and scan again.',
};

export default function TableLanding({token}: {token: string}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Guard against the double invocation of effects in development.
    if (started.current) return;
    started.current = true;

    if (!isFirebaseConfigured) {
      setError('This app is not configured yet. See .env.example and docs/11-FIREBASE-SETUP.md.');
      return;
    }
    // Without App Check every callable is rejected before it runs; say so
    // rather than letting the guest see an opaque failure.
    if (isAppCheckMissing) {
      setError('This app is not configured yet. App Check is required; see docs/11-FIREBASE-SETUP.md.');
      return;
    }

    api
      .resolveTableQr({token})
      .then((session) => {
        writeGuestSession({
          capability: session.capability,
          sessionId: session.sessionId,
          tableLabel: session.tableLabel,
          expiresAt: session.capabilityExpiresAt,
        });
        // Replace, so the token never stays in history on a shared phone.
        router.replace('/menu');
      })
      .catch((failure: unknown) => {
        const apiError = failure as ApiError;
        setError(MESSAGES[apiError.code] ?? 'We could not open the menu for this table. Please ask a member of staff.');
      });
  }, [token, router]);

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Bukhara Restaurant</p>
        <h1 style={{margin: '8px 0 0', fontSize: 30}}>Welcome to your table</h1>
      </header>
      <div className="stack" style={{marginTop: 20}}>
        {error ? <Notice tone="error">{error}</Notice> : <Spinner label="Opening the menu" />}
      </div>
    </main>
  );
}
