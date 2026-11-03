'use client';
/** Administration home. Each area states plainly whether it is implemented. */
import Link from 'next/link';
import {Notice} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';

export default function AdminPage() {
  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Bukhara Restaurant</p>
        <h1 style={{margin: '8px 0 0', fontSize: 26}}>Administration</h1>
      </header>

      <div className="stack" style={{marginTop: 20}}>
        <StaffGuard requireAdmin>
          {() => (
            <>
              <section className="card" style={{padding: 16}}>
                <h2 style={{margin: '0 0 8px', fontSize: 18}}>Tables and QR codes</h2>
                <p className="muted small" style={{margin: '0 0 12px'}}>
                  Review every table and replace a damaged or copied QR code.
                </p>
                <Link href="/admin/tables" className="btn">
                  Manage tables
                </Link>
              </section>

              <Notice tone="warn">
                Menu editing, media upload, staff administration and reporting are still run from the command-line scripts
                (<code>import:menu</code>, <code>qr:provision</code>, <code>staff:provision</code>). Their screens are not built yet.
              </Notice>
            </>
          )}
        </StaffGuard>
      </div>
    </main>
  );
}
