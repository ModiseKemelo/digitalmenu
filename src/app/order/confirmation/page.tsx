'use client';

import {Suspense} from 'react';
import Link from 'next/link';
import {CheckCircle2, Clock3} from 'lucide-react';
import {useSearchParams} from 'next/navigation';
import GuestChrome from '@/components/GuestChrome';

function Confirmation() {
  const orderId = useSearchParams().get('order');
  return (
    <GuestChrome title="The kitchen has it." subtitle="Sit back and enjoy the evening while we prepare your order." hideCartBar>
      <div className="card confirmation-card">
        <span className="success-emblem">
          <CheckCircle2 size={34} strokeWidth={1.75} />
        </span>
        <p className="sectionlabel">Order received</p>
        <h2>Thank you</h2>
        <p className="muted">
          Your order is with the restaurant and a waiter will bring it to your table.
        </p>
        {orderId && (
          <p className="small muted" style={{margin: '14px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6}}>
            <Clock3 size={14} strokeWidth={2} />
            Reference: {orderId}
          </p>
        )}
      </div>
      <div className="confirmation-actions">
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
