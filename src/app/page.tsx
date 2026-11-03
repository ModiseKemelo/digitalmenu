import Link from 'next/link';

/**
 * The public entry point. Guests reach the menu by scanning their table's QR
 * code, never from here: a table-specific capability is what authorizes
 * ordering, so there is deliberately no "browse as a guest" link.
 */
export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Gaborone, Botswana</p>
        <h1 style={{margin: '10px 0 0', fontSize: 34}}>Bukhara Restaurant</h1>
        <p style={{margin: '10px 0 0', opacity: 0.9}}>Digital menu and table ordering</p>
      </section>

      <div className="card" style={{padding: 18, marginTop: 20}}>
        <h2 style={{margin: 0, fontSize: 18}}>Scan the code on your table</h2>
        <p className="muted" style={{margin: '8px 0 0'}}>
          Each table has its own QR code. Scanning it opens the menu for that table and lets you order from your phone.
        </p>
      </div>

      <nav className="row" style={{marginTop: 20, flexWrap: 'wrap'}}>
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
