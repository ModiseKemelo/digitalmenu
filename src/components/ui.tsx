'use client';
/** Small presentational pieces shared across the guest and staff screens. */
import Link from 'next/link';
import type {ReactNode} from 'react';
import type {OrderStatus} from '@/lib/contracts';
import {formatBwp} from '@/lib/order-domain';

export function Money({minor}: {minor: number}) {
  return <span className="price">{formatBwp(minor)}</span>;
}

export function StatusBadge({status}: {status: OrderStatus}) {
  const label: Record<OrderStatus, string> = {
    received: 'Received',
    accepted: 'Accepted',
    preparing: 'Preparing',
    ready: 'Ready',
    served: 'Served',
    cancelled: 'Cancelled',
  };
  return <span className={`badge badge-${status}`}>{label[status]}</span>;
}

export function Notice({tone = 'info', children}: {tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode}) {
  return (
    <div className={tone === 'info' ? 'notice' : `notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  );
}

/** Image placeholder until approved photography is supplied (acceptance criterion 2). */
export function Photo({label = 'Photo pending approval'}: {label?: string}) {
  return (
    <div className="photo" aria-hidden>
      {label}
    </div>
  );
}

export function Spinner({label = 'Loading'}: {label?: string}) {
  return (
    <p className="muted small" role="status">
      {label}…
    </p>
  );
}

export function BackLink({href, children}: {href: string; children: ReactNode}) {
  return (
    <Link href={href} className="small muted" style={{textDecoration: 'none'}}>
      ← {children}
    </Link>
  );
}
