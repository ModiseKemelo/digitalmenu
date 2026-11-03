'use client';
/** Administration home. Each area states plainly whether it is implemented. */
import Link from 'next/link';
import {QrCode} from 'lucide-react';
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
              <section className="card" style={{padding: 18}}>
                <div className="row" style={{alignItems: 'flex-start'}}>
                  <span className="feature-icongold">
                    <QrCode size={20} strokeWidth={1.75} />
                  </span>
                  <div style={{flex: 1}}>
                    <h2 style={{margin: '0 0 8px', fontSize: 19}}>Tables and QR codes</h2>
                    <p className="muted small" style={{margin: '0 0 14px'}}>
                      Review every table and replace a damaged or copied QR code.
                    </p>
                    <Link href="/admin/tables" className="btn">
                      Manage tables
                    </Link>
                  </div>
                </div>
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
