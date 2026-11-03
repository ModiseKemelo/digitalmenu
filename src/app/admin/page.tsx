'use client';
/** Administration home. Each area states plainly whether it is implemented. */
import Link from 'next/link';
import {ChartNoAxesCombined, Image as ImageIcon, ListOrdered, QrCode, Settings, Users} from 'lucide-react';
import {Notice} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';

export default function AdminPage() {
  return (
    <OperationsShell area="admin" title="Restaurant overview" subtitle="Manage Bukhara’s menu, dining room and service team.">
      <div className="stack">
        <StaffGuard requireAdmin>
          {() => (
            <>
              <section className="admin-statbar">
                <div className="card"><span>Configured tables</span><strong>20</strong></div>
                <div className="card"><span>Menu categories</span><strong>16</strong></div>
                <div className="card"><span>Restaurant</span><strong>Online</strong></div>
              </section>
              <section className="admin-grid">
                <Link href="/admin/tables" className="card admin-card"><span className="feature-icongold"><QrCode size={21} /></span><h2>Tables & QR codes</h2><p>Manage dining tables and rotate secure guest access codes.</p><b>Manage tables →</b></Link>
                <article className="card admin-card muted-card"><span className="feature-icongold"><ListOrdered size={21} /></span><h2>Menu & pricing</h2><p>Publish dishes, update options, pricing and availability.</p><b>Command-line managed</b></article>
                <article className="card admin-card muted-card"><span className="feature-icongold"><ImageIcon size={21} /></span><h2>Media library</h2><p>Review approved photography and missing menu imagery.</p><b>Planned screen</b></article>
                <article className="card admin-card muted-card"><span className="feature-icongold"><Users size={21} /></span><h2>Staff</h2><p>Manage staff accounts, roles and operational access.</p><b>Command-line managed</b></article>
                <article className="card admin-card muted-card"><span className="feature-icongold"><ChartNoAxesCombined size={21} /></span><h2>Reports</h2><p>Review service speed, sales and payment reconciliation.</p><b>Planned screen</b></article>
                <article className="card admin-card muted-card"><span className="feature-icongold"><Settings size={21} /></span><h2>Settings</h2><p>Restaurant profile, service rules and audit history.</p><b>Planned screen</b></article>
              </section>
              <Notice tone="warn">
                Menu editing and staff administration remain available through the existing command-line tools until their screens are implemented.
              </Notice>
            </>
          )}
        </StaffGuard>
      </div>
    </OperationsShell>
  );
}
