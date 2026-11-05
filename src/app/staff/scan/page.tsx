'use client';
/**
 * Opening a table as staff.
 *
 * A camera QR scanner is planned; until then a waiter picks the table from the
 * list, which needs no new permissions and works on every device. Either way
 * the table view is authorized by the staff account, not by the QR code.
 */
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {Armchair} from 'lucide-react';
import {collection, getDocs, orderBy, query} from 'firebase/firestore';
import {firebase} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import {BackLink, CardListSkeleton, Notice} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';

type TableRow = {id: string; label: string; enabled: boolean; busy: boolean};

function TableList() {
  const branchId = useBranchId();
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const {db} = firebase();
    getDocs(query(collection(db, `${branchPath(branchId)}/tables`), orderBy('label')))
      .then((snapshot) =>
        setTables(
          snapshot.docs.map((document) => {
            const data = document.data();
            return {
              id: document.id,
              label: String(data.label ?? document.id),
              enabled: data.enabled === true,
              busy: Boolean(data.activeSessionId),
            };
          }),
        ),
      )
      .catch(() => setError('Could not load the tables. Check your connection.'));
  }, [branchId]);

  return (
    <>
      <BackLink href="/staff">Live orders</BackLink>
      {error && <Notice tone="error">{error}</Notice>}
      {!tables && !error && <CardListSkeleton count={8} lines={1} grid label="Loading tables" />}
      {tables && tables.length === 0 && (
        <Notice tone="warn">No tables have been provisioned yet. Run the table provisioning script.</Notice>
      )}
      <section className="ops-table-grid">
        {(tables ?? []).map((table) => (
          <Link key={table.id} href={`/staff/tables/${table.id}`} className={`card ops-table-card${table.busy ? ' busy' : ''}`}>
            <div className="row" style={{justifyContent: 'space-between'}}>
              <span className="row" style={{gap: 10}}>
                <Armchair size={20} strokeWidth={1.75} style={{color: 'var(--gold-deep)'}} />
                <strong>{table.label}</strong>
              </span>
              <span className={`badge ${table.busy ? 'badge-ready' : ''}`}>{table.busy ? 'Seated' : 'Free'}</span>
            </div>
            {!table.enabled && (
              <p className="small muted" style={{margin: '8px 0 0'}}>
                Out of service
              </p>
            )}
          </Link>
        ))}
      </section>
    </>
  );
}

export default function StaffScanPage() {
  return (
    <OperationsShell area="staff" title="Open a table" subtitle="Select a table to view its active dining session.">
      <div className="stack">
        <StaffGuard>{() => <TableList />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
