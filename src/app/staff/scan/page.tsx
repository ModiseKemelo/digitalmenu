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
import {collection, getDocs, orderBy, query} from 'firebase/firestore';
import {firebase, RESTAURANT_ID} from '@/lib/firebase-client';
import {Notice, Spinner, BackLink} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';

type TableRow = {id: string; label: string; enabled: boolean; busy: boolean};

function TableList() {
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const {db} = firebase();
    getDocs(query(collection(db, `restaurants/${RESTAURANT_ID}/tables`), orderBy('label')))
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
  }, []);

  return (
    <>
      <BackLink href="/staff">Live orders</BackLink>
      {error && <Notice tone="error">{error}</Notice>}
      {!tables && !error && <Spinner label="Loading tables" />}
      {tables && tables.length === 0 && (
        <Notice tone="warn">No tables have been provisioned yet. Run the table provisioning script.</Notice>
      )}
      <section className="gridcards">
        {(tables ?? []).map((table) => (
          <Link key={table.id} href={`/staff/tables/${table.id}`} className="card" style={{padding: 16, textDecoration: 'none'}}>
            <div className="between">
              <strong>{table.label}</strong>
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
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Bukhara Restaurant</p>
        <h1 style={{margin: '8px 0 0', fontSize: 26}}>Open a table</h1>
      </header>
      <div className="stack" style={{marginTop: 20}}>
        <StaffGuard>{() => <TableList />}</StaffGuard>
      </div>
    </main>
  );
}
