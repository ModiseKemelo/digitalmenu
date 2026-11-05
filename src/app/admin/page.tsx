'use client';
/** Administration home. Each area states plainly whether it is implemented. */
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {Building2, ChartNoAxesCombined, Image as ImageIcon, ListOrdered, QrCode, Settings, Users} from 'lucide-react';
import {collection, getCountFromServer, query, where} from 'firebase/firestore';
import {firebase} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import {Notice} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';

/**
 * Live counts for the overview tiles.
 *
 * These were previously hardcoded ("20 tables", "16 categories") and had drifted
 * from reality. A dashboard that invents its figures is worse than one with no
 * figures, so they are counted on the server — an aggregation query, not a read
 * of every document.
 */
function useCounts(branchId: string) {
  const [counts, setCounts] = useState<{tables: number; categories: number; items: number} | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCounts(null);
    setFailed(false);
    const {db} = firebase();
    const base = branchPath(branchId);
    Promise.all([
      getCountFromServer(collection(db, `${base}/tables`)),
      getCountFromServer(query(collection(db, `${base}/categories`), where('published', '==', true))),
      getCountFromServer(query(collection(db, `${base}/menuItems`), where('published', '==', true))),
    ])
      .then(([tables, categories, items]) =>
        setCounts({
          tables: tables.data().count,
          categories: categories.data().count,
          items: items.data().count,
        }),
      )
      .catch(() => setFailed(true));
  }, [branchId]);

  return {counts, failed};
}

function Overview() {
  const branchId = useBranchId();
  const {counts, failed} = useCounts(branchId);
  const show = (value: number | undefined) => (failed ? '—' : (value ?? '…'));

  return (
    <>
      <section className="admin-statbar">
        <div className="card"><span>Tables</span><strong>{show(counts?.tables)}</strong></div>
        <div className="card"><span>Published categories</span><strong>{show(counts?.categories)}</strong></div>
        <div className="card"><span>Published dishes</span><strong>{show(counts?.items)}</strong></div>
      </section>
      {failed && <Notice tone="warn">Could not read the current counts. The figures above are unavailable, not zero.</Notice>}

      <section className="admin-grid">
        <Link href="/admin/tables" className="card admin-card"><span className="feature-icongold"><QrCode size={21} /></span><h2>Tables &amp; QR codes</h2><p>Manage dining tables and rotate secure guest access codes.</p><b>Manage tables →</b></Link>
        <Link href="/admin/menu" className="card admin-card"><span className="feature-icongold"><ListOrdered size={21} /></span><h2>Menu &amp; pricing</h2><p>Publish dishes, update choices, prices and availability.</p><b>Edit the menu →</b></Link>
        <Link href="/admin/media" className="card admin-card"><span className="feature-icongold"><ImageIcon size={21} /></span><h2>Media library</h2><p>See which dishes a guest views without a photograph.</p><b>Review photography →</b></Link>
        <Link href="/admin/staff" className="card admin-card"><span className="feature-icongold"><Users size={21} /></span><h2>Staff</h2><p>Accounts, roles and who may work at which location.</p><b>Manage the team →</b></Link>
        <Link href="/admin/branches" className="card admin-card"><span className="feature-icongold"><Building2 size={21} /></span><h2>Branches</h2><p>Add a location and scope its tables, staff and pricing.</p><b>Manage locations →</b></Link>
        <Link href="/admin/reports" className="card admin-card"><span className="feature-icongold"><ChartNoAxesCombined size={21} /></span><h2>Reports</h2><p>Sales, service speed and what is still owed.</p><b>Open reports →</b></Link>
        <Link href="/admin/settings" className="card admin-card"><span className="feature-icongold"><Settings size={21} /></span><h2>Settings</h2><p>Location profile, service notes and the audit trail.</p><b>Open settings →</b></Link>
      </section>

      <Notice>
        The command-line tools remain the right choice for a bulk menu reload or provisioning a whole dining room at
        once; these screens are for the everyday changes that should not need a laptop.
      </Notice>
    </>
  );
}

export default function AdminPage() {
  return (
    <OperationsShell area="admin" title="Restaurant overview" subtitle="Manage Bukhara’s menu, dining room and service team.">
      <div className="stack">
        <StaffGuard requireAdmin>{() => <Overview />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
