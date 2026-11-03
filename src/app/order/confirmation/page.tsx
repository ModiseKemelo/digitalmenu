'use client';

import {Suspense} from 'react';
import Link from 'next/link';
import {CheckCircle2, Clock3} from 'lucide-react';
import {useSearchParams} from 'next/navigation';
import GuestChrome from '@/components/GuestChrome';

function Confirmation() {
  const orderId = useSearchParams().get('order');
  return (
    <GuestChrome title="Order placed" hideCartBar>
      <div className="card" style={{padding: 26, textAlign: 'center'}}>
        <span className="success-emblem">
          <CheckCircle2 size={34} strokeWidth={1.75} />
        </span>
        <h2 style={{margin: '16px 0 0', fontSize: 22}}>Thank you</h2>
        <p className="muted" style={{margin: '8px 0 0'}}>
          Your order is with the restaurant and a waiter will bring it to your table.
        </p>
        {orderId && (
          <p className="small muted" style={{margin: '14px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6}}>
            <Clock3 size={14} strokeWidth={2} />
            Reference: {orderId}
          </p>
        )}
      </div>
      <div className="row" style={{flexWrap: 'wrap'}}>
        <Link href="/orders" className="btn">
          Track my order
        </Link>
        <Link href="/menu" className="btn btn-ghost">
          Order something else
        </Link>
      </div>
    </GuestChrome>
  );
}

export default function ConfirmationPage() {
  return (
    <Suspense fallback={null}>
      <Confirmation />
    </Suspense>
  );
}
