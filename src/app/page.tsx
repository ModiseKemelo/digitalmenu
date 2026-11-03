import Link from 'next/link';
import {QrCode, UtensilsCrossed, Sparkles} from 'lucide-react';

/**
 * The public entry point. Guests reach the menu by scanning their table's QR
 * code, never from here: a table-specific capability is what authorizes
 * ordering, so there is deliberately no "browse as a guest" link.
 */
export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Gaborone · Botswana</p>
        <h1 style={{margin: '12px 0 0', fontSize: 40}}>Bukhara Restaurant</h1>
        <p style={{margin: '12px 0 0', opacity: 0.9, maxWidth: 480}}>
          The flavours of the Silk Road, from our kitchen to your table.
        </p>
      </section>

      <div className="card" style={{padding: 22, marginTop: 20}}>
        <div className="row" style={{alignItems: 'flex-start'}}>
          <span className="feature-icongold">
            <QrCode size={22} strokeWidth={1.75} />
          </span>
          <div style={{flex: 1}}>
            <h2 style={{margin: 0, fontSize: 20}}>Scan the code on your table</h2>
            <p className="muted" style={{margin: '8px 0 0'}}>
              Each table has its own QR code. Scanning it opens the menu for that table and lets you order from your
              phone — no app, no waiting.
            </p>
          </div>
        </div>
      </div>

      <div className="gridcards" style={{marginTop: 16}}>
        <div className="card" style={{padding: 18}}>
          <UtensilsCrossed size={22} strokeWidth={1.75} style={{color: 'var(--gold-deep)'}} />
          <h3 style={{margin: '12px 0 0', fontSize: 18}}>Browse the menu</h3>
          <p className="muted small" style={{margin: '6px 0 0'}}>
            Courses, dishes and photographs — all at your fingertips once you scan in.
          </p>
        </div>
        <div className="card" style={{padding: 18}}>
          <Sparkles size={22} strokeWidth={1.75} style={{color: 'var(--gold-deep)'}} />
          <h3 style={{margin: '12px 0 0', fontSize: 18}}>Order as you go</h3>
          <p className="muted small" style={{margin: '6px 0 0'}}>
            Add dishes, make your choices and send them straight to the kitchen.
          </p>
        </div>
      </div>

      <hr className="rule" style={{margin: '24px 0'}} />

      <nav className="row" style={{flexWrap: 'wrap'}}>
        <Link href="/staff" className="btn btn-ghost">
          Staff
        </Link>
        <Link href="/admin" className="btn btn-ghost">
          Administration
        </Link>
      </nav>
    </main>
  );
}
