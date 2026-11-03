'use client';

import {Suspense} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {Notice} from '@/components/ui';
import GuestChrome from '@/components/GuestChrome';

function Confirmation() {
  const orderId = useSearchParams().get('order');
  return (
    <GuestChrome title="Order placed" hideCartBar>
      <Notice tone="ok">
        Thank you. Your order is with the restaurant and a waiter will bring it to your table.
      </Notice>
      {orderId && (
        <p className="small muted" style={{margin: 0}}>
          Reference: {orderId}
        </p>
      )}
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
