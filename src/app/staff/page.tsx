'use client';
/**
 * The live waiter dashboard.
 *
 * Orders arrive over a Firestore snapshot listener rather than by polling, so a
 * new order appears without a refresh (acceptance criterion 5). An audible and
 * visible alert is the fallback for a waiter who is not looking at the screen.
 */
import {useEffect, useMemo, useRef, useState} from 'react';
import Link from 'next/link';
import {ScanLine, Volume2, VolumeX} from 'lucide-react';
import {collectionGroup, onSnapshot, query, where, orderBy} from 'firebase/firestore';
import {firebase, RESTAURANT_ID} from '@/lib/firebase-client';
import {ACTIVE_ORDER_STATUSES, nextStatuses, canRoleTransition} from '@/lib/order-domain';
import type {OrderStatus} from '@/lib/contracts';
import {api, ApiError} from '@/lib/api';
import {Money, Notice, Spinner, StatusBadge} from '@/components/ui';
import StaffGuard, {type StaffProfile} from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';

type LiveOrder = {
  id: string;
  sessionId: string;
  tableId: string;
  status: OrderStatus;
  totalMinor: number;
  version: number;
  source: string;
  createdAtMs: number;
  items: {name: string; quantity: number; notes: string}[];
};

/** A short tone, synthesised so the app needs no audio asset. */
function useAlertTone() {
  const context = useRef<AudioContext | null>(null);
  return () => {
    try {
      context.current ??= new AudioContext();
      const audio = context.current;
      if (audio.state === 'suspended') void audio.resume();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.4);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.42);
    } catch {
      // Audio is a convenience; the badge below is the reliable signal.
    }
  };
}

function Dashboard({staff}: {staff: StaffProfile}) {
  const [orders, setOrders] = useState<LiveOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const knownIds = useRef<Set<string> | null>(null);
  const [unseen, setUnseen] = useState(0);
  const playTone = useAlertTone();

  useEffect(() => {
    const {db} = firebase();
    const live = query(
      collectionGroup(db, 'orders'),
      where('restaurantId', '==', RESTAURANT_ID),
      where('status', 'in', ACTIVE_ORDER_STATUSES),
      orderBy('createdAt', 'desc'),
    );

    return onSnapshot(
      live,
      (snapshot) => {
        const next = snapshot.docs.map((document) => {
          const data = document.data();
          return {
            id: document.id,
            sessionId: String(data.sessionId ?? ''),
            tableId: String(data.tableId ?? ''),
            status: data.status as OrderStatus,
            totalMinor: Number(data.totalMinor ?? 0),
            version: Number(data.version ?? 0),
            source: String(data.source ?? 'guest'),
            createdAtMs: data.createdAt?.toMillis?.() ?? 0,
            items: Array.isArray(data.items)
              ? (data.items as {name: string; quantity: number; notes?: string}[]).map((item) => ({
                  name: String(item.name),
                  quantity: Number(item.quantity),
                  notes: String(item.notes ?? ''),
                }))
              : [],
          } satisfies LiveOrder;
        });

        // Only alert for orders that appear after the first load, so opening
        // the dashboard does not fire for the existing queue.
        const ids = new Set(next.map((order) => order.id));
        if (knownIds.current) {
          const fresh = next.filter((order) => !knownIds.current!.has(order.id) && order.status === 'received');
          if (fresh.length > 0) {
            setUnseen((count) => count + fresh.length);
            if (soundOn) playTone();
          }
        }
        knownIds.current = ids;
        setOrders(next);
        setError(null);
      },
      () => setError('The live order feed was interrupted. Check your connection; this screen will reconnect.'),
    );
  }, [soundOn, playTone]);

  const advance = async (order: LiveOrder, nextStatus: OrderStatus) => {
    setBusyId(order.id);
    setError(null);
    try {
      await api.updateOrderStatus({
        sessionId: order.sessionId,
        orderId: order.id,
        nextStatus,
        expectedVersion: order.version,
      });
    } catch (failure) {
      const apiError = failure as ApiError;
      setError(
        apiError.code === 'version-conflict'
          ? 'Another device changed this order first. The list has refreshed — please look again.'
          : apiError.message,
      );
    } finally {
      setBusyId(null);
    }
  };

  const byTable = useMemo(() => {
    const groups = new Map<string, LiveOrder[]>();
    for (const order of orders ?? []) {
      groups.set(order.tableId, [...(groups.get(order.tableId) ?? []), order]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [orders]);

  return (
    <>
      <div className="between" style={{flexWrap: 'wrap'}}>
        <p className="muted small" style={{margin: 0}}>
          Signed in as {staff.name} ({staff.role})
        </p>
        <div className="row">
          <Link href="/staff/scan" className="btn btn-ghost small">
            <ScanLine size={16} strokeWidth={2} />
            Scan a table
          </Link>
          <button
            type="button"
            className="btn btn-ghost small"
            onClick={() => {
              setSoundOn((on) => !on);
              if (!soundOn) playTone(); // also unlocks audio on this device
            }}
          >
            {soundOn ? <Volume2 size={16} strokeWidth={2} /> : <VolumeX size={16} strokeWidth={2} />}
            Sound {soundOn ? 'on' : 'off'}
          </button>
        </div>
      </div>

      {orders && (
        <section className="ops-stats">
          <div className="card"><span>Waiting</span><strong>{orders.filter((order) => order.status === 'received').length.toString().padStart(2, '0')}</strong></div>
          <div className="card"><span>Preparing</span><strong>{orders.filter((order) => order.status === 'accepted' || order.status === 'preparing').length.toString().padStart(2, '0')}</strong></div>
          <div className="card"><span>Ready</span><strong>{orders.filter((order) => order.status === 'ready').length.toString().padStart(2, '0')}</strong></div>
          <div className="card"><span>Active tables</span><strong>{byTable.length.toString().padStart(2, '0')}</strong></div>
        </section>
      )}

      {unseen > 0 && (
        <button type="button" className="notice notice-warn" style={{textAlign: 'left'}} onClick={() => setUnseen(0)}>
          <strong>
            {unseen} new {unseen === 1 ? 'order' : 'orders'}
          </strong>{' '}
          — tap to acknowledge this alert.
        </button>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {!orders && !error && <Spinner label="Connecting to the live order feed" />}
      {orders && orders.length === 0 && <Notice tone="ok">No orders are waiting. The dining room is clear.</Notice>}

      {byTable.map(([tableId, tableOrders]) => (
        <section key={tableId} className="card ops-order-group">
          <div className="between">
            <h2 style={{margin: 0, fontSize: 18}}>{tableId}</h2>
            <Link href={`/staff/tables/${tableId}`} className="small">
              Open table
            </Link>
          </div>

          <div className="stack" style={{marginTop: 12}}>
            {tableOrders.map((order) => (
              <div key={order.id} style={{borderTop: '1px solid var(--line)', paddingTop: 12}}>
                <div className="between">
                  <StatusBadge status={order.status} />
                  <Money minor={order.totalMinor} />
                </div>
                <ul className="small" style={{listStyle: 'none', padding: 0, margin: '8px 0 0'}}>
                  {order.items.map((item, index) => (
                    <li key={index}>
                      {item.quantity} × {item.name}
                      {item.notes && <span className="muted"> — “{item.notes}”</span>}
                    </li>
                  ))}
                </ul>
                {order.source === 'waiter' && (
                  <p className="small muted" style={{margin: '6px 0 0'}}>
                    Taken by a waiter
                  </p>
                )}
                <div className="row" style={{marginTop: 10, flexWrap: 'wrap'}}>
                  {nextStatuses(order.status)
                    .filter((status) => canRoleTransition(staff.role, order.status, status))
                    .map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={status === 'cancelled' ? 'btn btn-ghost small' : 'btn small'}
                        disabled={busyId === order.id}
                        onClick={() => void advance(order, status)}
                      >
                        {status === 'cancelled' ? 'Cancel' : `Mark ${status}`}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export default function StaffDashboardPage() {
  return (
    <OperationsShell area="staff" title="Live orders" subtitle="Real-time kitchen queue and table service.">
      <div className="stack">
        <StaffGuard>{(staff) => <Dashboard staff={staff} />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
