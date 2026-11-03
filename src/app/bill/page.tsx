'use client';
/**
 * Asking for the bill or for assistance.
 *
 * Settlement is handled by a waiter in person, so this screen requests service
 * rather than taking any payment. It deliberately shows only the guest's own
 * items: the table total may include other guests' orders and is confirmed by
 * the waiter.
 */
import {useEffect, useState} from 'react';
import {api, ApiError} from '@/lib/api';
import {readGuestSession} from '@/lib/guest-session';
import type {GuestSessionView, ServiceRequestType} from '@/lib/contracts';
import {Money, Notice, Spinner} from '@/components/ui';
import GuestChrome from '@/components/GuestChrome';

export default function BillPage() {
  const [view, setView] = useState<GuestSessionView | null>(null);
  const [requested, setRequested] = useState<ServiceRequestType | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = readGuestSession();
    if (!session) return;
    api
      .getGuestSessionView({capability: session.capability})
      .then(setView)
      .catch(() => setError('We could not load your items. Your waiter can still bring the bill.'));
  }, []);

  const request = async (type: ServiceRequestType) => {
    const session = readGuestSession();
    if (!session) {
      setError('Your table session has expired. Please scan the QR code on your table again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createServiceRequest({capability: session.capability, type});
      setRequested(type);
    } catch (failure) {
      const apiError = failure as ApiError;
      setError(
        apiError.code === 'rate-limited'
          ? 'Your request has already been sent. A waiter is on the way.'
          : 'We could not send that request. Please catch a waiter’s eye instead.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <GuestChrome title="Bill and assistance" hideCartBar>
      {!view && !error && <Spinner label="Loading your items" />}

      {view && (
        <div className="between card" style={{padding: 16}}>
          <div>
            <strong>Your items</strong>
            <p className="small muted" style={{margin: '4px 0 0'}}>
              Others at your table may have ordered separately.
            </p>
          </div>
          <strong>
            <Money minor={view.ownTotalMinor} />
          </strong>
        </div>
      )}

      {requested === 'bill' && <Notice tone="ok">A waiter is bringing your bill.</Notice>}
      {requested === 'assistance' && <Notice tone="ok">A waiter is on the way to your table.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Notice>Payment is taken at the table by cash or card. This app does not process payments.</Notice>

      <div className="row" style={{flexWrap: 'wrap'}}>
        <button type="button" className="btn" onClick={() => void request('bill')} disabled={busy}>
          Request the bill
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void request('assistance')} disabled={busy}>
          Call a waiter
        </button>
      </div>
    </GuestChrome>
  );
}
