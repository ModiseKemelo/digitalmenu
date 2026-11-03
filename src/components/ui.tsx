'use client';
/** Small presentational pieces shared across the guest and staff screens. */
import Link from 'next/link';
import Image from 'next/image';
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

/**
 * A dish photograph, falling back to a placeholder when none is approved yet
 * (acceptance criterion 2).
 *
 * `src` is an absolute URL. Menu photographs live in our own Cloud Storage
 * bucket and are publicly readable: a menu photo is public by nature, and a
 * signed URL would expire in the middle of service.
 *
 * Decorative when it illustrates a name that is already on screen — an empty
 * alt keeps a screen reader from reading every dish twice.
 */
export function Photo({
  src,
  alt = '',
  label = 'Photo pending approval',
  priority = false,
}: {
  src?: string | null;
  alt?: string;
  label?: string;
  priority?: boolean;
}) {
  if (!src) {
    return (
      <div className="photo" aria-hidden>
        {label}
      </div>
    );
  }

  return (
    <div className="photo photo-filled">
      <Image
        src={src}
        alt={alt}
        fill
        // Cards sit in a responsive grid: roughly full width on a phone, and
        // about a third of a wide screen.
        sizes="(max-width: 600px) 100vw, 33vw"
        style={{objectFit: 'cover'}}
        priority={priority}
      />
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
