'use client';
/**
 * Waiter-assisted ordering.
 *
 * `submitWaiterOrder` has existed since the first backend pass but had no
 * screen, so a guest without a smartphone, or one ordering over the counter,
 * could not be served through the system at all — their order had to be
 * carried in someone's head.
 *
 * The waiter picks a table and composes the order. Prices are shown for the
 * waiter's benefit only: the callable re-prices every line from Firestore, so
 * what is displayed here can never become what is charged.
 */
import {useEffect, useMemo, useState} from 'react';
import {useRouter} from 'next/navigation';
import {Minus, Plus, Search, Trash2} from 'lucide-react';
import {collection, getDocs, orderBy, query} from 'firebase/firestore';
import {firebase} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import {fetchCategories, fetchPublishedItems, type MenuCategory, type MenuItem} from '@/lib/menu-data';
import {MAX_LINE_QUANTITY, MAX_ORDER_LINES} from '@/lib/contracts';
import {api, ApiError, newIdempotencyKey} from '@/lib/api';
import {Money, Notice, Spinner} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';

type TableRow = {id: string; label: string; enabled: boolean; busy: boolean};
type Line = {itemId: string; name: string; unitPriceMinor: number; quantity: number};

function Composer() {
  const branchId = useBranchId();
  const router = useRouter();
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [tableId, setTableId] = useState('');
  const [categories, setCategories] = useState<MenuCategory[] | null>(null);
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One key per composed order, generated when the screen opens and renewed
  // after each submission, so a double tap or a retried request cannot create
  // the same order twice.
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

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

    Promise.all([fetchCategories(), fetchPublishedItems()])
      .then(([loadedCategories, loadedItems]) => {
        setCategories(loadedCategories);
        setItems(loadedItems);
      })
      .catch(() => setError('Could not load the menu. Check your connection.'));
  }, [branchId]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (items ?? [])
      .filter((item) => (categoryId ? item.categoryId === categoryId : true))
      .filter((item) => (term ? item.name.toLowerCase().includes(term) : true))
      .slice(0, 60);
  }, [items, categoryId, search]);

  const totalMinor = lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);

  const add = (item: MenuItem) => {
    setError(null);
    setLines((current) => {
      const existing = current.find((line) => line.itemId === item.id);
      if (existing) {
        if (existing.quantity >= MAX_LINE_QUANTITY) return current;
        return current.map((line) =>
          line.itemId === item.id ? {...line, quantity: line.quantity + 1} : line,
        );
      }
      if (current.length >= MAX_ORDER_LINES) {
        setError(`An order may hold at most ${MAX_ORDER_LINES} different dishes. Send this one, then start another.`);
        return current;
      }
      return [...current, {itemId: item.id, name: item.name, unitPriceMinor: item.priceMinor, quantity: 1}];
    });
  };

  const setQuantity = (itemId: string, delta: number) =>
    setLines((current) =>
      current
        .map((line) =>
          line.itemId === itemId
            ? {...line, quantity: Math.min(MAX_LINE_QUANTITY, Math.max(0, line.quantity + delta))}
            : line,
        )
        .filter((line) => line.quantity > 0),
    );

  const submit = async () => {
    if (!tableId || lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.submitWaiterOrder({
        branchId,
        tableId,
        items: lines.map((line) => ({itemId: line.itemId, quantity: line.quantity, optionIds: [], notes: ''})),
        idempotencyKey,
      });
      setLines([]);
      setIdempotencyKey(newIdempotencyKey());
      router.push(`/staff/tables/${tableId}?placed=${result.orderId}`);
    } catch (failure) {
      const apiError = failure as ApiError;
      setError(
        apiError.code === 'table-disabled'
          ? 'That table is out of service. Choose another table.'
          : apiError.code === 'item-unavailable'
            ? 'One of these dishes has just been marked unavailable. Remove it and send the order again.'
            : apiError.code === 'session-closed'
              ? 'That table has just been closed. Re-open it and try again.'
              : 'We could not send that order. Nothing has been charged — please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const loading = !tables || !items || !categories;

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !error && <Spinner label="Loading tables and menu" />}

      {!loading && (
        <div className="composer">
          <section className="card composer-pick">
            <label htmlFor="composer-table">Table</label>
            <select id="composer-table" value={tableId} onChange={(event) => setTableId(event.target.value)}>
              <option value="">Choose a table…</option>
              {(tables ?? [])
                .filter((table) => table.enabled)
                .map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.label}
                    {table.busy ? ' · seated' : ' · free'}
                  </option>
                ))}
            </select>
            <p className="small muted">
              A free table is opened as a new dining session when the order is sent.
            </p>
          </section>

          <section className="composer-menu">
            <div className="composer-filters">
              <div className="composer-search">
                <Search size={16} aria-hidden />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search dishes"
                  aria-label="Search dishes"
                />
              </div>
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {(categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            {visibleItems.length === 0 && <Notice>No dishes match that search.</Notice>}

            <div className="composer-items">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="card composer-item"
                  onClick={() => add(item)}
                  disabled={!item.available}
                >
                  <span>
                    <strong>{item.name}</strong>
                    {!item.available && <small> · unavailable</small>}
                  </span>
                  <b><Money minor={item.priceMinor} /></b>
                </button>
              ))}
            </div>
          </section>

          <section className="card composer-cart">
            <h2>Order</h2>
            {lines.length === 0 && <p className="small muted">Tap a dish to add it.</p>}
            {lines.map((line) => (
              <div key={line.itemId} className="composer-line">
                <span>
                  <strong>{line.name}</strong>
                  <small><Money minor={line.unitPriceMinor * line.quantity} /></small>
                </span>
                <span className="qty">
                  <button type="button" onClick={() => setQuantity(line.itemId, -1)} aria-label={`One fewer ${line.name}`}>
                    <Minus size={15} />
                  </button>
                  <b>{line.quantity}</b>
                  <button type="button" onClick={() => setQuantity(line.itemId, 1)} aria-label={`One more ${line.name}`}>
                    <Plus size={15} />
                  </button>
                </span>
              </div>
            ))}

            {lines.length > 0 && (
              <>
                <div className="composer-total">
                  <span>Estimated total</span>
                  <strong><Money minor={totalMinor} /></strong>
                </div>
                <p className="small muted">
                  The kitchen re-prices every line from the menu, so this figure is a guide for you, not the charge.
                </p>
                <div className="composer-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setLines([])} disabled={busy}>
                    <Trash2 size={16} /> Clear
                  </button>
                  <button type="button" className="btn" onClick={() => void submit()} disabled={busy || !tableId}>
                    {busy ? 'Sending…' : 'Send to kitchen'}
                  </button>
                </div>
                {!tableId && <p className="small muted">Choose a table before sending.</p>}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export default function WaiterOrderPage() {
  return (
    <OperationsShell
      area="staff"
      title="Take an order"
      subtitle="Order on a guest’s behalf — at the counter, over the phone, or for a table without a smartphone."
    >
      <div className="stack">
        <StaffGuard>{() => <Composer />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
