'use client';
/**
 * Table and QR management.
 *
 * Rotating a code returns the new token exactly once, to be printed
 * immediately: Firestore keeps only its hash, so it cannot be shown again. The
 * old code stops working the moment it is rotated.
 */
import {useCallback, useEffect, useState} from 'react';
import {collection, getDocs, orderBy, query} from 'firebase/firestore';
import {firebase, RESTAURANT_ID} from '@/lib/firebase-client';
import {api, ApiError} from '@/lib/api';
import {Notice, Spinner, BackLink} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import QrLabel from '@/components/QrLabel';

type TableRow = {id: string; label: string; enabled: boolean; busy: boolean; tokenVersion: number};
type Issued = {tableId: string; label: string; payload: string};

function Tables() {
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<Issued | null>(null);

  const load = useCallback(async () => {
    try {
      const {db} = firebase();
      const snapshot = await getDocs(query(collection(db, `restaurants/${RESTAURANT_ID}/tables`), orderBy('label')));
      setTables(
        snapshot.docs.map((document) => {
          const data = document.data();
          return {
            id: document.id,
            label: String(data.label ?? document.id),
            enabled: data.enabled === true,
            busy: Boolean(data.activeSessionId),
            tokenVersion: Number(data.qrTokenVersion ?? 0),
          };
        }),
      );
    } catch {
      setError('Could not load the tables.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rotate = async (tableId: string, label: string) => {
    if (
      !window.confirm(
        `Issue a new QR code for ${label}?\n\nThe code currently on the table stops working immediately, ` +
          'so only do this if that label is damaged, lost, or being replaced.',
      )
    )
      return;
    setBusyId(tableId);
    setError(null);
    try {
      const result = await api.rotateTableQrToken({tableId});
      setNewToken({tableId, label, payload: result.printableQrPayload});
      await load();
    } catch (failure) {
      setError((failure as ApiError).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <BackLink href="/admin">Administration</BackLink>
      {error && <Notice tone="error">{error}</Notice>}

      {newToken && (
        <Notice tone="warn">
          <p style={{margin: '0 0 12px'}}>
            <strong>New code for {newToken.label}.</strong> Print it now — it cannot be shown again, and the
            previous label for this table no longer works.
          </p>
          <QrLabel label={newToken.label} tableId={newToken.tableId} payload={newToken.payload} />
        </Notice>
      )}

      <Notice>
        A table&rsquo;s QR code is a key to that table, so only its SHA-256 hash is stored and a code can never be
        shown twice. To replace a damaged or missing label, issue a new code here and print it — the old one stops
        working at once.
      </Notice>

      {!tables && !error && <Spinner label="Loading tables" />}
      {tables && tables.length === 0 && (
        <Notice tone="warn">
          No tables exist yet. Provision them with <code>npm run qr:provision</code>, which also produces the printable sheet.
        </Notice>
      )}

      <section className="stack">
        {(tables ?? []).map((table) => (
          <div key={table.id} className="card between" style={{padding: 16}}>
            <div>
              <strong>{table.label}</strong>
              <p className="small muted" style={{margin: '4px 0 0'}}>
                {table.id} · code v{table.tokenVersion} · {table.busy ? 'seated' : 'free'}
                {!table.enabled && ' · out of service'}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost small"
              onClick={() => void rotate(table.id, table.label)}
              disabled={busyId === table.id}
            >
              {busyId === table.id ? 'Issuing…' : 'Issue new code'}
            </button>
          </div>
        ))}
      </section>
    </>
  );
}

export default function AdminTablesPage() {
  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Bukhara Restaurant · Administration</p>
        <h1 style={{margin: '8px 0 0', fontSize: 26}}>Tables and QR codes</h1>
      </header>
      <div className="stack" style={{marginTop: 20}}>
        <StaffGuard requireAdmin>{() => <Tables />}</StaffGuard>
      </div>
    </main>
  );
}
