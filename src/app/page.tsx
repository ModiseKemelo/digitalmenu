import Link from 'next/link';
import {ConciergeBell, QrCode, Sparkles} from 'lucide-react';
import Brand from '@/components/Brand';

/**
 * The public entry point. Guests reach the menu by scanning their table's QR
 * code, never from here: a table-specific capability is what authorizes
 * ordering, so there is deliberately no "browse as a guest" link.
 */
export default function Home() {
  return (
    <main className="public-shell">
      <header className="public-brandbar">
        <Brand />
        <span className="public-location">Gaborone · Botswana</span>
      </header>

      <section className="public-hero">
        <div>
          <p className="eyebrow">A culinary odyssey</p>
          <h1>The world,<br />served beautifully.</h1>
          <p>Discover flame-grilled favourites, fragrant curries and global classics—crafted in the heart of Gaborone.</p>
        </div>
        <span className="hero-spark" aria-hidden>✦</span>
      </section>

      <div className="public-sectionhead">
        <h2>Good evening</h2>
        <span>Welcome to Bukhara</span>
      </div>

      <section className="scan-panel">
        <div>
          <p className="eyebrow">Dining with us?</p>
          <h2>Scan your table</h2>
          <p>Each table has its own secure QR code. Scan it to open the menu and order directly from your seat.</p>
          <Link href="/scan" className="btn">Scan my table code</Link>
        </div>
        <div className="qr-art" aria-hidden><QrCode size={82} strokeWidth={1.2} /></div>
      </section>

      <section className="public-features">
        <article className="card feature-row">
          <span className="feature-icongold"><Sparkles size={21} /></span>
          <div>
            <h3>Freshly prepared</h3>
            <p>Every plate is made to order by our kitchen.</p>
          </div>
        </article>
        <article className="card feature-row">
          <span className="feature-icongold"><ConciergeBell size={21} /></span>
          <div>
            <h3>Service at your fingertips</h3>
            <p>Track dishes, request the bill or call your waiter.</p>
          </div>
        </article>
      </section>

      <footer className="public-footer">
        <span>Restaurant team</span>
        <nav><Link href="/staff">Staff sign-in</Link><Link href="/admin">Administration</Link></nav>
      </footer>
    </main>
  );
}
