'use client';
/**
 * Shared frame for every guest screen: the table header, the session guard and
 * the sticky cart bar.
 *
 * A guest with no valid capability is sent back to scanning rather than shown a
 * half-working menu, because an expired capability means the server will refuse
 * every action anyway.
 */
import {useEffect, useState, type ReactNode} from 'react';
import Link from 'next/link';
import {readGuestSession, type GuestSession} from '@/lib/guest-session';
import {useCart} from '@/lib/cart';
import {Money, Notice} from './ui';

export default function GuestChrome({
  title,
  subtitle,
  children,
  hideCartBar = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  hideCartBar?: boolean;
}) {
  const [session, setSession] = useState<GuestSession | null>(null);
  const [checked, setChecked] = useState(false);
  const cart = useCart();

  useEffect(() => {
    setSession(readGuestSession());
    setChecked(true);
  }, []);

  if (checked && !session) {
    return (
      <main className="shell">
        <header className="hero">
          <p className="eyebrow">Bukhara Restaurant</p>
          <h1 style={{margin: '8px 0 0', fontSize: 28}}>Scan your table code</h1>
        </header>
        <div style={{marginTop: 20}}>
          <Notice tone="warn">
            Your table session has ended or expired. Please scan the QR code on your table again to see the menu and order.
          </Notice>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="shell">
        <header className="hero">
          <p className="eyebrow">Bukhara Restaurant{session ? ` · ${session.tableLabel}` : ''}</p>
          <h1 style={{margin: '8px 0 0', fontSize: 28}}>{title}</h1>
          {subtitle && (
            <p className="small" style={{margin: '10px 0 0', opacity: 0.85}}>
              {subtitle}
            </p>
          )}
          <nav className="row small" style={{marginTop: 16, flexWrap: 'wrap', gap: 14}}>
            <Link href="/menu" style={{color: 'var(--gold)'}}>
              Menu
            </Link>
            <Link href="/orders" style={{color: 'var(--gold)'}}>
              My orders
            </Link>
            <Link href="/bill" style={{color: 'var(--gold)'}}>
              Bill
            </Link>
          </nav>
        </header>
        <div className="stack" style={{marginTop: 20}}>{children}</div>
      </main>

      {!hideCartBar && cart.count > 0 && (
        <div className="cartbar">
          <div className="inner">
            <div style={{flex: 1}}>
              <p className="small muted" style={{margin: 0}}>
                {cart.count} {cart.count === 1 ? 'item' : 'items'}
              </p>
              <p style={{margin: 0, fontWeight: 700}}>
                <Money minor={cart.displayTotalMinor} />
              </p>
            </div>
            <Link href="/cart" className="btn">
              Review order
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
