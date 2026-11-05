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
import {ReceiptText, ConciergeBell} from 'lucide-react';
import {api, ApiError} from '@/lib/api';
import {readGuestSession} from '@/lib/guest-session';
import type {GuestSessionView, ServiceRequestType} from '@/lib/contracts';
import {CardListSkeleton, Money, Notice} from '@/components/ui';
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
      if (apiError.code === 'rate-limited') {
        setError('Your request has already been sent. A waiter is on the way.');
      } else if (apiError.code === 'nothing-to-bill') {
        // The server refused because the table owes nothing. Re-read the view
        // so the button settles into its disabled state rather than inviting
        // another tap.
        setError('There is nothing on your bill yet. Place an order first, or call a waiter for help.');
        setView((current) => (current ? {...current, tableHasChargeableOrders: false} : current));
      } else {
        setError('We could not send that request. Please catch a waiter’s eye instead.');
      }
    } finally {
      setBusy(false);
    }
  };

  // The server is the authority on whether a bill exists; this only decides
  // whether to offer the button. While the view is unknown (still loading, or
  // it failed to load) the tap is allowed through, so a network hiccup cannot
  // strand a guest who does have a bill to settle.
  const canRequestBill = !view || view.tableHasChargeableOrders;

  return (
    <GuestChrome title="Bill and assistance" hideCartBar>
      {!view && !error && <CardListSkeleton count={1} lines={2} label="Loading your items" />}

      {view && (
        <div className="between card bill-total-card">
          <div>
            <span className="small muted">Your items so far</span>
            <strong>Personal total</strong>
            <p className="small muted" style={{margin: '4px 0 0'}}>
              {view.tableHasChargeableOrders
                ? 'Others at your table may have ordered separately.'
                : 'Nothing has been ordered at this table yet.'}
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

      <div className="content-heading compact"><div><p className="sectionlabel">At your table</p><h2>How can we help?</h2></div></div>
      <div className="service-actions">
        <button
          type="button"
          className="service-action"
          onClick={() => void request('bill')}
          disabled={busy || !canRequestBill}
          aria-describedby={canRequestBill ? undefined : 'bill-unavailable'}
        >
          <span className="feature-icongold"><ReceiptText size={19} /></span>
          <span>
            <strong>Request the bill</strong>
            <small id={canRequestBill ? undefined : 'bill-unavailable'}>
              {canRequestBill
                ? 'A waiter will bring it to your table.'
                : 'Available once something has been ordered at your table.'}
            </small>
          </span>
          <b>→</b>
        </button>
        <button type="button" className="service-action" onClick={() => void request('assistance')} disabled={busy}>
          <span className="feature-icongold"><ConciergeBell size={19} /></span>
          <span><strong>Call a waiter</strong><small>For assistance with your meal.</small></span><b>→</b>
        </button>
      </div>

      <Notice>Payment is taken at the table by cash or card. This app does not process payments.</Notice>
    </GuestChrome>
  );
}
