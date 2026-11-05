'use client';
/**
 * Reports.
 *
 * Everything here is counted from the documents the service itself wrote —
 * sessions and orders — rather than from a separate tally that could drift.
 * Where a figure cannot be derived honestly it is left out and said so, which
 * is the whole point of a reconciliation screen.
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Timestamp, collection, collectionGroup, getDocs, limit, orderBy, query, where} from 'firebase/firestore';
import {firebase} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import {formatBwp} from '@/lib/order-domain';
import type {OrderStatus} from '@/lib/contracts';
import {BackLink, CardListSkeleton, Notice} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';

const RANGES = [
  {id: 'today', label: 'Today', days: 0},
  {id: '7', label: 'Last 7 days', days: 7},
  {id: '30', label: 'Last 30 days', days: 30},
] as const;
type RangeId = (typeof RANGES)[number]['id'];

/** A hard ceiling so one query cannot read a year of orders by accident. */
const ORDER_SCAN_LIMIT = 1500;
const SESSION_SCAN_LIMIT = 600;

type SessionRow = {chargeTotalMinor: number; paidMinor: number; balanceMinor: number; status: string; openedAtMs: number};
type OrderRow = {
  status: OrderStatus;
  totalMinor: number;
  createdAtMs: number;
  servedAfterMs: number | null;
  items: {name: string; quantity: number; lineTotalMinor: number}[];
};

function startOf(range: RangeId): Date {
  const from = new Date();
  if (range === 'today') {
    from.setHours(0, 0, 0, 0);
    return from;
  }
  from.setDate(from.getDate() - Number(range));
  return from;
}

type HistoryEntry = {status?: string; at?: {toMillis?: () => number} | Date | null};

/** Minutes from the order arriving to it being marked served, or null if it never was. */
function servedAfter(createdAtMs: number, history: unknown): number | null {
  if (!Array.isArray(history) || !createdAtMs) return null;
  for (const raw of history as HistoryEntry[]) {
    if (raw?.status !== 'served') continue;
    const at = raw.at;
    const ms = at instanceof Date ? at.getTime() : typeof at?.toMillis === 'function' ? at.toMillis() : null;
    if (ms) return Math.max(0, ms - createdAtMs);
  }
  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function Reports() {
  const branchId = useBranchId();
  const [range, setRange] = useState<RangeId>('today');
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setSessions(null);
    setOrders(null);
    setError(null);
    setTruncated(false);
    const from = Timestamp.fromDate(startOf(range));
    const {db} = firebase();

    try {
      const [sessionSnapshot, orderSnapshot] = await Promise.all([
        getDocs(
          query(
            collection(db, `${branchPath(branchId)}/sessions`),
            where('openedAt', '>=', from),
            orderBy('openedAt', 'desc'),
            limit(SESSION_SCAN_LIMIT),
          ),
        ),
        getDocs(
          query(
            collectionGroup(db, 'orders'),
            where('restaurantId', '==', branchId),
            where('createdAt', '>=', from),
            orderBy('createdAt', 'desc'),
            limit(ORDER_SCAN_LIMIT),
          ),
        ),
      ]);

      setSessions(
        sessionSnapshot.docs.map((document) => {
          const data = document.data();
          return {
            chargeTotalMinor: Number(data.chargeTotalMinor ?? 0),
            paidMinor: Number(data.paidMinor ?? 0),
            balanceMinor: Number(data.balanceMinor ?? 0),
            status: String(data.status ?? 'open'),
            openedAtMs: data.openedAt?.toMillis?.() ?? 0,
          };
        }),
      );

      setOrders(
        orderSnapshot.docs.map((document) => {
          const data = document.data();
          const createdAtMs = data.createdAt?.toMillis?.() ?? 0;
          return {
            status: (data.status ?? 'received') as OrderStatus,
            totalMinor: Number(data.totalMinor ?? 0),
            createdAtMs,
            servedAfterMs: servedAfter(createdAtMs, data.statusHistory),
            items: Array.isArray(data.items)
              ? (data.items as {name?: string; quantity?: number; lineTotalMinor?: number}[]).map((item) => ({
                  name: String(item.name ?? 'Unnamed dish'),
                  quantity: Number(item.quantity ?? 0),
                  lineTotalMinor: Number(item.lineTotalMinor ?? 0),
                }))
              : [],
          };
        }),
      );

      setTruncated(
        sessionSnapshot.size >= SESSION_SCAN_LIMIT || orderSnapshot.size >= ORDER_SCAN_LIMIT,
      );
    } catch (failure) {
      // A missing composite index is the one failure an administrator can act
      // on, and Firestore puts the creation link in the message.
      setError(
        `Could not read the figures for this period. ${
          String((failure as {message?: string}).message ?? '').includes('index')
            ? 'A Firestore index is still building; try again in a few minutes.'
            : ''
        }`.trim(),
      );
      setSessions([]);
      setOrders([]);
    }
  }, [branchId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = useMemo(() => {
    const rows = sessions ?? [];
    const charged = rows.reduce((total, row) => total + row.chargeTotalMinor, 0);
    const collected = rows.reduce((total, row) => total + row.paidMinor, 0);
    const outstanding = rows
      .filter((row) => row.status === 'open')
      .reduce((total, row) => total + Math.max(0, row.balanceMinor), 0);
    const paying = rows.filter((row) => row.chargeTotalMinor > 0);
    return {
      charged,
      collected,
      outstanding,
      covers: rows.length,
      average: paying.length ? Math.round(charged / paying.length) : 0,
      unsettled: rows.filter((row) => row.status === 'closed' && row.balanceMinor > 0).length,
    };
  }, [sessions]);

  const service = useMemo(() => {
    const rows = orders ?? [];
    const served = rows.map((row) => row.servedAfterMs).filter((value): value is number => value !== null);
    return {
      placed: rows.length,
      cancelled: rows.filter((row) => row.status === 'cancelled').length,
      open: rows.filter((row) => !['served', 'cancelled'].includes(row.status)).length,
      medianMinutes: median(served) === null ? null : Math.round((median(served) as number) / 60000),
      measured: served.length,
    };
  }, [orders]);

  const topDishes = useMemo(() => {
    const tally = new Map<string, {quantity: number; revenueMinor: number}>();
    for (const order of orders ?? []) {
      if (order.status === 'cancelled') continue;
      for (const item of order.items) {
        const row = tally.get(item.name) ?? {quantity: 0, revenueMinor: 0};
        row.quantity += item.quantity;
        row.revenueMinor += item.lineTotalMinor;
        tally.set(item.name, row);
      }
    }
    return [...tally.entries()]
      .map(([name, row]) => ({name, ...row}))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
  }, [orders]);

  const loading = sessions === null || orders === null;

  return (
    <>
      <BackLink href="/admin">Administration</BackLink>

      <div className="range-tabs" role="group" aria-label="Reporting period">
        {RANGES.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`btn btn-ghost small${range === option.id ? ' active' : ''}`}
            aria-pressed={range === option.id}
            onClick={() => setRange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {truncated && (
        <Notice tone="warn">
          This period has more activity than one report reads at once. The figures below cover the most recent
          {` ${SESSION_SCAN_LIMIT} `}tables and{` ${ORDER_SCAN_LIMIT} `}orders, so treat them as a sample rather than
          a total.
        </Notice>
      )}

      {loading && <CardListSkeleton count={3} lines={2} label="Counting the period" />}

      {!loading && (
        <>
          <section className="admin-statbar">
            <div className="card"><span>Tables served</span><strong>{money.covers}</strong></div>
            <div className="card"><span>Charged</span><strong>{formatBwp(money.charged)}</strong></div>
            <div className="card"><span>Collected</span><strong>{formatBwp(money.collected)}</strong></div>
            <div className="card"><span>Still owed at open tables</span><strong>{formatBwp(money.outstanding)}</strong></div>
          </section>

          <section className="admin-statbar">
            <div className="card"><span>Average per paying table</span><strong>{formatBwp(money.average)}</strong></div>
            <div className="card"><span>Orders placed</span><strong>{service.placed}</strong></div>
            <div className="card"><span>Cancelled</span><strong>{service.cancelled}</strong></div>
            <div className="card">
              <span>Order to served, typical</span>
              <strong>{service.medianMinutes === null ? '—' : `${service.medianMinutes} min`}</strong>
            </div>
          </section>

          {money.unsettled > 0 && (
            <Notice tone="warn">
              {money.unsettled === 1
                ? 'One table was closed while still owing money.'
                : `${money.unsettled} tables were closed while still owing money.`}{' '}
              Each of those closures recorded a manager reason; they are listed in the audit trail under Settings.
            </Notice>
          )}

          <Notice>
            Charged and collected come from the table documents themselves, so they always agree with the bills that
            were presented. A cash-versus-card split is not shown here: payment rows live under each table and
            totalling them across a month would mean reading every one.
          </Notice>

          <div className="content-heading compact">
            <div>
              <p className="sectionlabel">What sold</p>
              <h2>Most ordered</h2>
            </div>
          </div>

          {topDishes.length === 0 && <Notice>Nothing was ordered in this period.</Notice>}

          <section className="admin-table-list">
            {topDishes.map((dish, index) => (
              <div key={dish.name} className="card admin-table-row">
                <div>
                  <strong>
                    <span className="rank">{index + 1}</span> {dish.name}
                  </strong>
                  <p className="small muted" style={{margin: '4px 0 0'}}>
                    {dish.quantity} ordered · {formatBwp(dish.revenueMinor)}
                  </p>
                </div>
              </div>
            ))}
          </section>

          {service.measured > 0 && service.measured < service.placed && (
            <p className="small muted">
              Service time is measured from the {service.measured} orders that reached &ldquo;served&rdquo;; the rest
              are still in progress or were cancelled.
            </p>
          )}
        </>
      )}
    </>
  );
}

export default function AdminReportsPage() {
  return (
    <OperationsShell area="admin" title="Reports" subtitle="Sales, service speed and what is still owed.">
      <div className="stack">
        <StaffGuard requireAdmin>{() => <Reports />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
