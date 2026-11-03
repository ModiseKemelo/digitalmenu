'use client';
/**
 * The guest's own orders and their live status.
 *
 * Read through a session-scoped callable, which returns only the orders this
 * capability submitted — not the whole table's (docs/04 privacy model).
 */
import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import {api, ApiError} from '@/lib/api';
import {readGuestSession} from '@/lib/guest-session';
import type {GuestSessionView} from '@/lib/contracts';
import {Money, Notice, Spinner, StatusBadge} from '@/components/ui';
import GuestChrome from '@/components/GuestChrome';

/** Polling interval: frequent enough to feel live, light enough to be cheap. */
const REFRESH_MS = 15_000;

function statusStep(status: GuestSessionView['orders'][number]['status']) {
  if (status === 'served') return 4;
  if (status === 'ready') return 3;
  if (status === 'preparing' || status === 'accepted') return 2;
  return status === 'received' ? 1 : 0;
}

export default function OrdersPage() {
  const [view, setView] = useState<GuestSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = readGuestSession();
    if (!session) {
      setError('Your table session has expired. Please scan the QR code on your table again.');
      return;
    }
    try {
      setView(await api.getGuestSessionView({capability: session.capability}));
      setError(null);
    } catch (failure) {
      const apiError = failure as ApiError;
      setError(
        apiError.code === 'capability-revoked' || apiError.code === 'capability-expired'
          ? 'Your table session has ended. Please scan the QR code on your table again.'
          : 'We could not load your orders. Please try again in a moment.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <GuestChrome title="My orders" subtitle="This list updates on its own while you are at the table.">
      {error && <Notice tone="error">{error}</Notice>}
      {!view && !error && <Spinner label="Loading your orders" />}

      {view && view.orders.length === 0 && (
        <Notice>
          You have not ordered anything yet. <Link href="/menu">Browse the menu</Link>.
        </Notice>
      )}

      {view && view.orders.length > 0 && <p className="sectionlabel">Your orders</p>}

      {view?.orders.map((order) => (
        <section key={order.orderId} className="card guest-order-card">
          <div className="between">
            <StatusBadge status={order.status} />
            <Money minor={order.totalMinor} />
          </div>
          <div className="status-track" aria-label={`Order status: ${order.status}`}>
            {['Received', 'Preparing', 'Ready', 'Served'].map((label, index) => (
              <span key={label} className={statusStep(order.status) > index ? 'done' : ''}><i />{label}</span>
            ))}
          </div>
          <ul className="stack small" style={{listStyle: 'none', padding: 0, margin: '12px 0 0', gap: 6}}>
            {order.items.map((item, index) => (
              <li key={index} className="between">
                <span>
                  {item.quantity} × {item.name}
                  {item.notes && <span className="muted"> — “{item.notes}”</span>}
                </span>
                <Money minor={item.lineTotalMinor} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {view && view.orders.length > 0 && (
        <div className="between card" style={{padding: 16}}>
          <strong>Your items</strong>
          <strong>
            <Money minor={view.ownTotalMinor} />
          </strong>
        </div>
      )}
    </GuestChrome>
  );
}
