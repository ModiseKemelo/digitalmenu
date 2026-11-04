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
import {Bell, Menu as MenuIcon, ReceiptText, ShoppingBag} from 'lucide-react';
import {usePathname} from 'next/navigation';
import {readGuestSession, type GuestSession} from '@/lib/guest-session';
import {useCart} from '@/lib/cart';
import {Money, Notice} from './ui';
import Brand from './Brand';

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
  const pathname = usePathname();

  useEffect(() => {
    setSession(readGuestSession());
    setChecked(true);
  }, []);

  if (!checked) {
    return (
      <main className="guest-shell">
        <div className="guest-brandbar"><Brand /></div>
        <div className="guest-session-loading" role="status">Opening your table…</div>
      </main>
    );
  }

  if (checked && !session) {
    return (
      <main className="guest-shell">
        <div className="guest-brandbar"><Brand /></div>
        <header className="guest-hero compact">
          <p className="eyebrow">Secure table access</p>
          <h1>Scan your table code</h1>
          <p>Your table code safely connects this phone to your dining session.</p>
        </header>
        <div className="guest-content">
          <Notice tone="warn">
            Your table session has ended or expired. Please scan the QR code on your table again to see the menu and order.
          </Notice>
          <Link href="/scan" className="btn">Scan my table code</Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="guest-shell">
        <div className="guest-brandbar">
          <Brand />
          {session && <span className="table-pill">{session.tableLabel}</span>}
        </div>
        <header className="guest-hero">
          <p className="eyebrow">{session ? `${session.tableLabel} · Dining menu` : 'Bukhara Restaurant'}</p>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </header>
        <div className="guest-content">{children}</div>
      </main>

      <nav className="guest-dock" aria-label="Guest navigation">
        <Link href="/menu" className={pathname.startsWith('/menu') ? 'active' : ''}>
          <MenuIcon size={20} /><span>Menu</span>
        </Link>
        <Link href="/orders" className={pathname === '/orders' || pathname.startsWith('/order/') ? 'active' : ''}>
          <ReceiptText size={20} /><span>Orders</span>
        </Link>
        <Link href="/bill" className={pathname === '/bill' ? 'active' : ''}>
          <Bell size={20} /><span>Service</span>
        </Link>
        <Link href="/cart" className={pathname === '/cart' ? 'active' : ''}>
          <span className="dock-cart-icon"><ShoppingBag size={20} />{cart.count > 0 && <b>{cart.count}</b>}</span>
          <span>Cart</span>
        </Link>
      </nav>

      {!hideCartBar && cart.count > 0 && (
        <div className="cartbar guest-cartbar">
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
