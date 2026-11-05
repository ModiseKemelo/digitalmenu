'use client';
/**
 * The live waiter dashboard.
 *
 * Orders arrive over a Firestore snapshot listener rather than by polling, so a
 * new order appears without a refresh (acceptance criterion 5). An audible and
 * visible alert is the fallback for a waiter who is not looking at the screen.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Link from 'next/link';
import {ScanLine, Volume2, VolumeX} from 'lucide-react';
import {collectionGroup, onSnapshot, query, where, orderBy} from 'firebase/firestore';
import {firebase} from '@/lib/firebase-client';
import {useBranchId} from '@/lib/branch';
import {ACTIVE_ORDER_STATUSES, nextStatuses, canRoleTransition} from '@/lib/order-domain';
import type {OrderStatus} from '@/lib/contracts';
import {api, ApiError} from '@/lib/api';
import {CardListSkeleton, Money, Notice, StatusBadge} from '@/components/ui';
import StaffGuard, {type StaffProfile} from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';

/**
 * What each transition is called on the button.
 *
 * The labels used to be built as `Mark ${status}`, which produced "Mark
 * accepted" and "Mark preparing" - the name of a state rather than the action
 * the button performs, so it was never obvious which one moved the order on.
 */
const ACTION_LABEL: Record<OrderStatus, string> = {
  received: 'Move back to waiting',
  accepted: 'Accept order',
  preparing: 'Start preparing',
  ready: 'Mark ready to serve',
  served: 'Mark served',
  cancelled: 'Cancel',
};

/** The stages an order passes through, for the progress strip on each order. */
const PIPELINE: OrderStatus[] = ['received', 'accepted', 'preparing', 'ready', 'served'];
const PIPELINE_LABEL: Record<string, string> = {
  received: 'Waiting',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
};

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

/**
 * A short tone, synthesised so the app needs no audio asset.
 *
 * Memoised deliberately. This function used to be a fresh closure on every
 * render, and it sits in the live listener's dependency array, so the board
 * tore down and re-created its Firestore subscription on every render. The new
 * subscription fired immediately, set state, and triggered another render: a
 * permanent resubscribe loop that burned reads and left the board showing
 * stale orders, so a status change never appeared and the stale version then
 * made the next transition fail as a conflict.
 */
function useAlertTone() {
  const context = useRef<AudioContext | null>(null);
  return useCallback(() => {
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
  }, []);
}

function Dashboard({staff}: {staff: StaffProfile}) {
  const branchId = useBranchId();
  const [orders, setOrders] = useState<LiveOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const knownIds = useRef<Set<string> | null>(null);
  const [unseen, setUnseen] = useState(0);
  const playTone = useAlertTone();
  /** Read inside the listener so toggling sound does not resubscribe it. */
  const soundOnRef = useRef(soundOn);
  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    const {db} = firebase();
    const live = query(
      collectionGroup(db, 'orders'),
      where('restaurantId', '==', branchId),
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
            if (soundOnRef.current) playTone();
          }
        }
        knownIds.current = ids;
        setOrders(next);
        setError(null);
      },
      () => setError('The live order feed was interrupted. Check your connection; this screen will reconnect.'),
    );
  }, [playTone, branchId]);

  const advance = async (order: LiveOrder, nextStatus: OrderStatus) => {
    setBusyId(order.id);
    setError(null);
    setDone(null);
    try {
      await api.updateOrderStatus({
        branchId,
        sessionId: order.sessionId,
        orderId: order.id,
        nextStatus,
        expectedVersion: order.version,
      });
      // The live feed redraws the badge, but on a busy screen the row may be
      // off-view, so say plainly that the tap landed.
      setDone(`${order.tableId}: ${PIPELINE_LABEL[nextStatus] ?? nextStatus}.`);
    } catch (failure) {
      const apiError = failure as ApiError;
      setError(
        apiError.code === 'version-conflict'
          ? 'Another device changed this order first. The list has refreshed — look again before trying.'
          : apiError.code === 'illegal-transition'
            ? 'That order has already moved on. The list has refreshed.'
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
      {done && !error && <Notice tone="ok">{done}</Notice>}
      {!orders && !error && <CardListSkeleton count={2} lines={4} label="Connecting to the live order feed" />}
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
                <ol className="order-pipeline" aria-label="Order progress">
                  {PIPELINE.map((stage) => {
                    const reached = PIPELINE.indexOf(order.status) >= PIPELINE.indexOf(stage);
                    const current = order.status === stage;
                    return (
                      <li
                        key={stage}
                        className={`${reached ? 'reached' : ''}${current ? ' current' : ''}`}
                        aria-current={current ? 'step' : undefined}
                      >
                        <span>{PIPELINE_LABEL[stage]}</span>
                      </li>
                    );
                  })}
                </ol>

                <div className="order-actions">
                  {nextStatuses(order.status)
                    .filter((status) => canRoleTransition(staff.role, order.status, status))
                    .map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={status === 'cancelled' ? 'btn btn-ghost small' : 'btn'}
                        disabled={busyId === order.id}
                        onClick={() => void advance(order, status)}
                      >
                        {busyId === order.id ? 'Saving…' : (ACTION_LABEL[status] ?? status)}
                      </button>
                    ))}
                  {nextStatuses(order.status).length === 0 && (
                    <p className="small muted" style={{margin: 0}}>No further action for this order.</p>
                  )}
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
