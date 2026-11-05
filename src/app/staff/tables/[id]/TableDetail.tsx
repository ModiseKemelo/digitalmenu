'use client';
/**
 * One table: its open session, orders, payments, balance and settlement.
 *
 * The balance shown is the server's derived figure, read live. Recording a
 * payment and closing the table both go through callables that re-verify the
 * balance in a transaction, so this screen cannot talk the server into closing
 * an unsettled table.
 */
import {useEffect, useState} from 'react';
import {collection, onSnapshot, query, where, limit, orderBy} from 'firebase/firestore';
import {firebase} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import {api, ApiError, newIdempotencyKey} from '@/lib/api';
import type {OrderStatus, PaymentMethod} from '@/lib/contracts';
import {isSettled} from '@/lib/order-domain';
import {BackLink, CardListSkeleton, Money, Notice, StatusBadge} from '@/components/ui';
import StaffGuard, {type StaffProfile} from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';
import ConfirmDialog from '@/components/ConfirmDialog';

type Session = {
  id: string;
  tableLabel: string;
  chargeTotalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  tipTotalMinor: number;
  version: number;
};

type Order = {id: string; status: OrderStatus; totalMinor: number};
type Payment = {
  id: string;
  type: string;
  amountMinor: number;
  tipMinor: number;
  method: string | null;
  reference: string;
  staffName: string;
  reversedByReversalId: string | null;
};

function Detail({tableId, staff}: {tableId: string; staff: StaffProfile}) {
  const branchId = useBranchId();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [amount, setAmount] = useState('');
  /** Optional, and usually empty: most tables do not tip, and the floor keeps cash tips as before. */
  const [tip, setTip] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** The payment awaiting a reversal reason, and whether the close dialog is up. */
  const [reversing, setReversing] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // Find the table's open session.
  useEffect(() => {
    const {db} = firebase();
    return onSnapshot(
      query(
        collection(db, `${branchPath(branchId)}/sessions`),
        where('tableId', '==', tableId),
        where('status', '==', 'open'),
        limit(1),
      ),
      (snapshot) => {
        const document = snapshot.docs[0];
        if (!document) {
          setSession(null);
          return;
        }
        const data = document.data();
        setSession({
          id: document.id,
          tableLabel: String(data.tableLabel ?? tableId),
          chargeTotalMinor: Number(data.chargeTotalMinor ?? 0),
          paidMinor: Number(data.paidMinor ?? 0),
          balanceMinor: Number(data.balanceMinor ?? 0),
          tipTotalMinor: Number(data.tipTotalMinor ?? 0),
          version: Number(data.version ?? 0),
        });
      },
      () => setError('Could not load this table. Check your connection.'),
    );
  }, [tableId, branchId]);

  // Follow that session's orders and payments.
  useEffect(() => {
    if (!session) return;
    const {db} = firebase();
    const base = `${branchPath(branchId)}/sessions/${session.id}`;
    const stopOrders = onSnapshot(query(collection(db, `${base}/orders`), orderBy('createdAt', 'desc')), (snapshot) =>
      setOrders(
        snapshot.docs.map((document) => ({
          id: document.id,
          status: document.data().status as OrderStatus,
          totalMinor: Number(document.data().totalMinor ?? 0),
        })),
      ),
    );
    const stopPayments = onSnapshot(query(collection(db, `${base}/payments`), orderBy('createdAt', 'desc')), (snapshot) =>
      setPayments(
        snapshot.docs.map((document) => {
          const data = document.data();
          return {
            id: document.id,
            type: String(data.type ?? 'payment'),
            amountMinor: Number(data.amountMinor ?? 0),
            tipMinor: Number(data.tipMinor ?? 0),
            method: (data.method as string | null) ?? null,
            reference: String(data.reference ?? ''),
            staffName: String(data.staffName ?? ''),
            reversedByReversalId: (data.reversedByReversalId as string | null) ?? null,
          };
        }),
      ),
    );
    return () => {
      stopOrders();
      stopPayments();
    };
  }, [session?.id, session, branchId]);

  /** Parses the typed amount into integer thebe without a float round-trip. */
  const parseAmountMinor = (value: string): number | null => {
    const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
    if (!match) return null;
    const thebe = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    return thebe > 0 ? thebe : null;
  };

  const recordPayment = async () => {
    if (!session) return;
    const amountMinor = parseAmountMinor(amount);
    if (amountMinor === null) {
      setError('Enter the amount received, for example 125.50.');
      return;
    }
    // Blank means no tip, which is the common case. A typed but unreadable tip
    // is a mistake worth stopping: silently dropping it would lose the money.
    const typedTip = tip.trim();
    const tipMinor = typedTip === '' ? 0 : parseAmountMinor(typedTip);
    if (tipMinor === null) {
      setError('Enter the tip as an amount, for example 20, or leave it blank.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.recordManualPayment({
        branchId,
        sessionId: session.id,
        amountMinor,
        tipMinor,
        method,
        reference: reference.trim(),
        idempotencyKey: newIdempotencyKey(),
      });
      setAmount('');
      setTip('');
      setReference('');
      const settled = result.balanceMinor <= 0 ? 'Payment recorded. This table is settled.' : 'Payment recorded.';
      setMessage(tipMinor > 0 ? `${settled} Tip noted separately.` : settled);
    } catch (failure) {
      setError((failure as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const reverse = async (paymentId: string, reason: string) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await api.reverseManualPayment({branchId, sessionId: session.id, paymentId, reason, idempotencyKey: newIdempotencyKey()});
      setMessage('Payment reversed.');
      setReversing(null);
    } catch (failure) {
      setError((failure as ApiError).message);
      setReversing(null);
    } finally {
      setBusy(false);
    }
  };

  const closeTable = async (managerExceptionReason?: string) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await api.closeDiningSession({branchId, sessionId: session.id, expectedVersion: session.version, managerExceptionReason});
      setMessage('Table closed.');
      setClosing(false);
    } catch (failure) {
      const apiError = failure as ApiError;
      setError(
        apiError.code === 'version-conflict'
          ? 'This table changed on another device. Please look again before closing.'
          : apiError.message,
      );
      setClosing(false);
    } finally {
      setBusy(false);
    }
  };

  if (session === undefined) return <CardListSkeleton count={3} lines={3} label="Loading this table" />;

  if (session === null) {
    return (
      <>
        <BackLink href="/staff">Live orders</BackLink>
        <Notice tone="ok">{tableId} has no open session. It is free for the next party.</Notice>
      </>
    );
  }

  return (
    <>
      <BackLink href="/staff">Live orders</BackLink>

      <section className="card session-summary">
        <h2 style={{margin: 0, fontSize: 20}}>{session.tableLabel}</h2>
        <div className="stack small" style={{marginTop: 12, gap: 6}}>
          <div className="between">
            <span className="muted">Ordered</span>
            <Money minor={session.chargeTotalMinor} />
          </div>
          <div className="between">
            <span className="muted">Paid</span>
            <Money minor={session.paidMinor} />
          </div>
          <div className="between" style={{fontSize: 16, fontWeight: 700, borderTop: '1px solid var(--line)', paddingTop: 8}}>
            <span>Balance</span>
            <Money minor={session.balanceMinor} />
          </div>
          {session.tipTotalMinor > 0 && (
            <div className="between">
              <span className="muted">Tip (not part of the bill)</span>
              <Money minor={session.tipTotalMinor} />
            </div>
          )}
        </div>
      </section>

      {message && <Notice tone="ok">{message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <section className="card payment-panel">
        <h3 style={{margin: '0 0 12px', fontSize: 16}}>Record a payment</h3>
        <div className="stack">
          <div>
            <label htmlFor="amount">Amount received (BWP)</label>
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="125.00"
            />
          </div>
          <div>
            <label htmlFor="tip">Tip (BWP, optional)</label>
            <input
              id="tip"
              inputMode="decimal"
              value={tip}
              onChange={(event) => setTip(event.target.value)}
              placeholder="Leave blank if none"
            />
          </div>
          <div>
            <label htmlFor="method">Method</label>
            <select id="method" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
            </select>
          </div>
          <div>
            <label htmlFor="reference">Reference (till or card authorisation)</label>
            <input id="reference" value={reference} onChange={(event) => setReference(event.target.value)} />
          </div>
          <button type="button" className="btn btn-gold" onClick={() => void recordPayment()} disabled={busy}>
            Record payment
          </button>
          <p className="small muted" style={{margin: 0}}>
            Partial payments are fine — record each one as it is taken. A tip is on top of the amount received and
            does not reduce the bill. Never record a card PIN or full card number.
          </p>
        </div>
      </section>

      {payments.length > 0 && (
        <section className="card" style={{padding: 16}}>
          <h3 style={{margin: '0 0 12px', fontSize: 16}}>Payments</h3>
          <div className="stack small">
            {payments.map((payment) => (
              <div key={payment.id} className="between" style={{borderTop: '1px solid var(--line)', paddingTop: 8}}>
                <div>
                  <p style={{margin: 0}}>
                    {payment.type === 'reversal' ? 'Reversal' : payment.method === 'card' ? 'Card' : 'Cash'}
                    {payment.reversedByReversalId && <span className="muted"> — reversed</span>}
                  </p>
                  <p className="muted" style={{margin: '2px 0 0'}}>
                    {payment.staffName}
                    {payment.reference && ` · ${payment.reference}`}
                  </p>
                  {payment.tipMinor !== 0 && (
                    <p className="muted" style={{margin: '2px 0 0'}}>
                      {payment.tipMinor < 0 ? 'Tip reversed: ' : 'Tip: '}
                      <Money minor={Math.abs(payment.tipMinor)} />
                    </p>
                  )}
                </div>
                <div className="row">
                  <span>
                    {payment.type === 'reversal' ? '−' : ''}
                    <Money minor={payment.amountMinor} />
                  </span>
                  {staff.role === 'admin' && payment.type === 'payment' && !payment.reversedByReversalId && (
                    <button type="button" className="btn btn-ghost small" onClick={() => setReversing(payment.id)} disabled={busy}>
                      Reverse
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card" style={{padding: 16}}>
        <h3 style={{margin: '0 0 12px', fontSize: 16}}>Orders on this table</h3>
        <div className="stack small">
          {orders.length === 0 && <p className="muted" style={{margin: 0}}>Nothing ordered yet.</p>}
          {orders.map((order) => (
            <div key={order.id} className="between">
              <StatusBadge status={order.status} />
              <Money minor={order.totalMinor} />
            </div>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="btn"
        onClick={() => setClosing(true)}
        disabled={busy}
        style={{width: '100%', background: isSettled(session.balanceMinor) ? undefined : 'var(--danger)', borderColor: 'transparent'}}
      >
        {isSettled(session.balanceMinor) ? 'Close this table' : 'Close with a written reason'}
      </button>

      <ConfirmDialog
        open={reversing !== null}
        tone="danger"
        title="Reverse this payment?"
        body={
          <p>
            The reversal is appended to the table&rsquo;s history rather than deleting the payment, and the balance
            goes back up by that amount.
          </p>
        }
        reason={{
          label: 'Why is this payment being reversed?',
          hint: 'Recorded against your name in the audit trail.',
          placeholder: 'For example: entered twice in error',
          minLength: 3,
        }}
        confirmLabel="Reverse payment"
        busy={busy}
        onCancel={() => setReversing(null)}
        onConfirm={(reason) => {
          if (reversing) void reverse(reversing, reason);
        }}
      />

      <ConfirmDialog
        open={closing}
        tone={isSettled(session.balanceMinor) ? 'default' : 'danger'}
        title={isSettled(session.balanceMinor) ? 'Close this table?' : 'Close an unsettled table?'}
        body={
          isSettled(session.balanceMinor) ? (
            <p>The guests lose access to their orders, and the table becomes free for the next party.</p>
          ) : (
            <p>
              This table still owes <Money minor={session.balanceMinor} />. You may close it now, but the reason is
              kept in the audit trail against your name and a manager reviews these after service.
            </p>
          )
        }
        reason={
          isSettled(session.balanceMinor)
            ? undefined
            : {
                label: 'Why is this table closing unsettled?',
                hint: 'Recorded against your name in the audit trail.',
                placeholder: 'For example: walkout, reported to the duty manager',
                minLength: 3,
              }
        }
        confirmLabel={isSettled(session.balanceMinor) ? 'Close table' : 'Close unsettled'}
        busy={busy}
        onCancel={() => setClosing(false)}
        onConfirm={(reason) => void closeTable(reason || undefined)}
      />
    </>
  );
}

export default function TableDetail({tableId}: {tableId: string}) {
  return (
    <OperationsShell area="staff" title={tableId} subtitle="Active table session, payments and order history.">
      <div className="stack">
        <StaffGuard>{(staff) => <Detail tableId={tableId} staff={staff} />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
