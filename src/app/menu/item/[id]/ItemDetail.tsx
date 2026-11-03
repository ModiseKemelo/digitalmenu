'use client';
/**
 * Dish detail and the add-to-order form.
 *
 * The price shown here is for the guest's benefit only. The order is priced
 * again from Firestore when it is submitted, so a stale or tampered page cannot
 * change what is charged.
 */
import {useEffect, useMemo, useState} from 'react';
import {useRouter} from 'next/navigation';
import {fetchItem, type MenuItem} from '@/lib/menu-data';
import {MAX_LINE_QUANTITY} from '@/lib/contracts';
import {unitPriceWithOptions} from '@/lib/order-domain';
import {useCart} from '@/lib/cart';
import {Money, Notice, Photo, Spinner, BackLink} from '@/components/ui';
import GuestChrome from '@/components/GuestChrome';

export default function ItemDetail({itemId}: {itemId: string}) {
  const router = useRouter();
  const cart = useCart();
  const [item, setItem] = useState<MenuItem | null | undefined>(undefined);
  const [chosen, setChosen] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetchItem(itemId)
      .then(setItem)
      .catch(() => setItem(null));
  }, [itemId]);

  // Memoised so it is a stable dependency of the price calculation below.
  const options = useMemo(() => item?.options ?? [], [item]);
  const unitPriceMinor = useMemo(() => {
    if (!item) return 0;
    const deltas = options.filter((option) => chosen.includes(option.id)).map((option) => option.priceDeltaMinor);
    try {
      return unitPriceWithOptions(item.priceMinor, deltas);
    } catch {
      return item.priceMinor;
    }
  }, [item, options, chosen]);

  if (item === undefined) {
    return (
      <GuestChrome title="Dish">
        <Spinner label="Loading dish" />
      </GuestChrome>
    );
  }

  if (item === null) {
    return (
      <GuestChrome title="Dish">
        <Notice tone="warn">This dish is not on the menu. Please go back and choose another.</Notice>
        <BackLink href="/menu">All categories</BackLink>
      </GuestChrome>
    );
  }

  const toggle = (optionId: string) =>
    setChosen((current) => (current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]));

  const addToOrder = () => {
    cart.add({
      itemId: item.id,
      quantity,
      optionIds: chosen,
      notes: notes.trim(),
      displayName: item.name,
      displayUnitPriceMinor: unitPriceMinor,
      optionLabels: options.filter((option) => chosen.includes(option.id)).map((option) => option.name),
    });
    router.push('/cart');
  };

  return (
    <GuestChrome title={item.name} hideCartBar>
      <BackLink href={`/menu/category/${item.categoryId}`}>Back to dishes</BackLink>

      <article className="card">
        <Photo src={item.primaryImagePath} alt={item.name} priority />
        <div style={{padding: 16}}>
          <div className="between">
            <h2 style={{margin: 0, fontSize: 20}}>{item.name}</h2>
            <Money minor={item.priceMinor} />
          </div>
          {item.description && <p style={{margin: '10px 0 0'}}>{item.description}</p>}
          {item.allergens.length > 0 && (
            <p className="small muted" style={{margin: '10px 0 0'}}>
              Allergens: {item.allergens.join(', ')}
            </p>
          )}
        </div>
      </article>

      {!item.available ? (
        <Notice tone="warn">This dish is unavailable today. Please choose something else.</Notice>
      ) : (
        <>
          {options.length > 0 && (
            <section className="card" style={{padding: 16}}>
              <h3 style={{margin: '0 0 10px', fontSize: 16}}>Choices</h3>
              <div className="stack" style={{gap: 8}}>
                {options.map((option) => (
                  <label key={option.id} className="row" style={{fontWeight: 400, marginBottom: 0}}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(option.id)}
                      onChange={() => toggle(option.id)}
                      disabled={option.available === false}
                      style={{width: 20, minHeight: 20, margin: 0}}
                    />
                    <span style={{flex: 1}}>
                      {option.name}
                      {option.available === false && <span className="muted small"> — unavailable</span>}
                    </span>
                    {option.priceDeltaMinor !== 0 && (
                      <span className="small muted">
                        {option.priceDeltaMinor > 0 ? '+' : '−'}
                        <Money minor={Math.abs(option.priceDeltaMinor)} />
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="card" style={{padding: 16}}>
            <label htmlFor="notes">Anything we should know?</label>
            <textarea
              id="notes"
              value={notes}
              maxLength={280}
              rows={3}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="For example: no chilli, well done"
            />
            <p className="small muted" style={{margin: '6px 0 0'}}>
              Please tell your waiter directly about any allergy.
            </p>
          </section>

          <div className="between">
            <div className="qty">
              <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Reduce quantity">
                −
              </button>
              <span aria-live="polite">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(MAX_LINE_QUANTITY, q + 1))}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            <button type="button" className="btn" onClick={addToOrder}>
              Add · <Money minor={unitPriceMinor * quantity} />
            </button>
          </div>
        </>
      )}
    </GuestChrome>
  );
}
