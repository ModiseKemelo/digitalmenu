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

/**
 * A real spinner. This used to render the label as plain text with no
 * indicator at all, so every one of the app's waiting states looked like a
 * sentence that had stopped loading rather than work in progress.
 *
 * aria-live is polite rather than assertive: a waiting state should not
 * interrupt a screen reader mid-sentence, and the label is announced once the
 * reader reaches it.
 */
export function Spinner({label = 'Loading', size = 22}: {label?: string; size?: number}) {
  return (
    <p className="spinner-line" role="status" aria-live="polite">
      <span className="spinner-ring" style={{width: size, height: size}} aria-hidden />
      <span>{label}…</span>
    </p>
  );
}

/**
 * A full-height branded wait, for the moments where there is nothing else on
 * screen yet: checking staff access, and the instant after a guest scans their
 * table. The scan especially is the first thing a guest ever sees of the
 * restaurant, so it should look deliberate rather than blank.
 */
export function PageLoader({label = 'Loading', hint}: {label?: string; hint?: string}) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <span className="page-loader-mark" aria-hidden>
        <span className="spinner-ring spinner-ring-lg" />
      </span>
      <strong>{label}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * One shimmering placeholder block.
 *
 * Skeletons are used in place of a spinner wherever the shape of what is
 * coming is already known. The layout does not jump when the content lands,
 * and a list that fades in reads as faster than a spinner that vanishes even
 * when it takes exactly as long.
 */
export function Skeleton({
  width,
  height = 14,
  radius = 8,
  className = '',
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
}) {
  return <span className={`skeleton ${className}`} style={{width, height, borderRadius: radius}} aria-hidden />;
}

/** Placeholder tiles for the menu's category grid. */
export function TileGridSkeleton({count = 6, label = 'Loading the menu'}: {count?: number; label?: string}) {
  return (
    <div className="menu-category-grid" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({length: count}, (_, index) => (
        <span key={index} className="skeleton skeleton-tile" aria-hidden />
      ))}
    </div>
  );
}

/** Placeholder rows for a list of dishes. */
export function DishListSkeleton({count = 5, label = 'Loading dishes'}: {count?: number; label?: string}) {
  return (
    <div className="dish-list" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({length: count}, (_, index) => (
        <div key={index} className="dish-row skeleton-row" aria-hidden>
          <span className="skeleton skeleton-thumb" />
          <div className="dish-row-copy skeleton-copy">
            <Skeleton width="62%" height={17} />
            <Skeleton width="92%" height={11} />
            <Skeleton width="38%" height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder cards, for order lists, table grids and panels. */
export function CardListSkeleton({
  count = 3,
  lines = 3,
  label = 'Loading',
  grid = false,
}: {
  count?: number;
  lines?: number;
  label?: string;
  grid?: boolean;
}) {
  return (
    <div className={grid ? 'ops-table-grid' : 'stack'} role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({length: count}, (_, index) => (
        <div key={index} className="card skeleton-card" aria-hidden>
          <Skeleton width="45%" height={16} />
          {Array.from({length: lines}, (_, line) => (
            <Skeleton key={line} width={line === lines - 1 ? '55%' : '85%'} height={11} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function BackLink({href, children}: {href: string; children: ReactNode}) {
  return (
    <Link href={href} className="small muted" style={{textDecoration: 'none'}}>
      ← {children}
    </Link>
  );
}
