'use client';

import {useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {api, ApiError} from '@/lib/api';
import {isFirebaseConfigured, isAppCheckMissing} from '@/lib/firebase-client';
import {writeGuestSession} from '@/lib/guest-session';
import {Notice, PageLoader} from '@/components/ui';
import Brand from '@/components/Brand';

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
    <main className="public-shell table-landing">
      <div className="public-brandbar"><Brand /><span className="public-location">Secure table access</span></div>
      <header className="public-hero">
        <div><p className="eyebrow">Welcome to Bukhara</p><h1>Your table<br />is ready.</h1>
        <p>We are securely opening the dining menu for this table.</p></div>
      </header>
      <div className="landing-status">
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <PageLoader label="Opening your menu" hint="Connecting this phone to your table's dining session." />
        )}
      </div>
    </main>
  );
}
