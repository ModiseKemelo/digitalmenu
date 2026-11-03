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

type TableRow = {id: string; label: string; enabled: boolean; busy: boolean; tokenVersion: number};

function Tables() {
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<{tableId: string; payload: string} | null>(null);

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

  const rotate = async (tableId: string) => {
    if (!window.confirm(`Replace the QR code for ${tableId}? The current printed code will stop working immediately.`)) return;
    setBusyId(tableId);
    setError(null);
    try {
      const result = await api.rotateTableQrToken({tableId});
      setNewToken({tableId, payload: result.printableQrPayload});
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
          <p style={{margin: '0 0 8px'}}>
            <strong>New code for {newToken.tableId}.</strong> Print it now — it cannot be shown again.
          </p>
          <code style={{wordBreak: 'break-all', fontSize: 12}}>{newToken.payload}</code>
        </Notice>
      )}

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
            <button type="button" className="btn btn-ghost small" onClick={() => void rotate(table.id)} disabled={busyId === table.id}>
              {busyId === table.id ? 'Replacing…' : 'Replace code'}
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
