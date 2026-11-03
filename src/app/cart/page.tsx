'use client';
/**
 * The cart and order submission.
 *
 * The idempotency key is generated once when the guest first taps "place
 * order" and reused for every retry, so a dropped response cannot become a
 * duplicate order. A failure is always reported as a failure: the cart is only
 * cleared once the server has confirmed the order (T05, T13, criterion 10).
 */
import {useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {Minus, Plus, Trash2} from 'lucide-react';
import {api, ApiError, newIdempotencyKey} from '@/lib/api';
import {readGuestSession, clearGuestSession} from '@/lib/guest-session';
import {useCart, toOrderLines} from '@/lib/cart';
import {Money, Notice, Spinner, BackLink} from '@/components/ui';
import GuestChrome from '@/components/GuestChrome';

const MESSAGES: Record<string, string> = {
  'capability-expired': 'Your table session has expired. Please scan the QR code on your table again.',
  'capability-revoked': 'This table session has been closed. Please scan the QR code on your table again.',
  'session-closed': 'This table has been closed. Please speak to a member of staff.',
  'item-unavailable': 'One of your dishes has just become unavailable. Please review your order.',
  'option-invalid': 'One of your choices is no longer available. Please review your order.',
  'rate-limited': 'That is a lot of orders in a short time. Please wait a moment and try again.',
  'invalid-request': 'Something about this order was not valid. Please review it and try again.',
};

export default function CartPage() {
  const cart = useCart();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept across retries so the server deduplicates them.
  const idempotencyKey = useRef<string | null>(null);

  const submit = async () => {
    const session = readGuestSession();
    if (!session) {
      setError('Your table session has expired. Please scan the QR code on your table again.');
      return;
    }
    if (cart.lines.length === 0) return;

    idempotencyKey.current ??= newIdempotencyKey();
    setSubmitting(true);
    setError(null);

    try {
      const result = await api.submitGuestOrder({
        capability: session.capability,
        items: toOrderLines(cart.lines),
        idempotencyKey: idempotencyKey.current,
      });
      cart.clear();
      idempotencyKey.current = null;
      router.push(`/order/confirmation?order=${encodeURIComponent(result.orderId)}`);
    } catch (failure) {
      const apiError = failure as ApiError;
      if (apiError.code === 'capability-expired' || apiError.code === 'capability-revoked') clearGuestSession();
      setError(
        MESSAGES[apiError.code] ??
          'We could not send your order. Nothing has been ordered yet — please check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GuestChrome title="Your order" hideCartBar>
      <BackLink href="/menu">Back to the menu</BackLink>

      {cart.lines.length === 0 ? (
        <Notice>
          Your order is empty. <Link href="/menu">Browse the menu</Link> to add dishes.
        </Notice>
      ) : (
        <>
          <section className="card cart-lines">
            {cart.lines.map((line, index) => (
              <div
                key={`${line.itemId}-${index}`}
                className="cart-line"
                style={{borderBottom: index === cart.lines.length - 1 ? 'none' : '1px solid var(--line)'}}
              >
                <div className="between">
                  <div style={{flex: 1}}>
                    <p style={{margin: 0, fontWeight: 600}}>{line.displayName}</p>
                    {line.optionLabels.length > 0 && (
                      <p className="small muted" style={{margin: '4px 0 0'}}>
                        {line.optionLabels.join(', ')}
                      </p>
                    )}
                    {line.notes && (
                      <p className="small muted" style={{margin: '4px 0 0'}}>
                        “{line.notes}”
                      </p>
                    )}
                  </div>
                  <Money minor={line.displayUnitPriceMinor * line.quantity} />
                </div>
                <div className="row" style={{marginTop: 10}}>
                  <div className="qty">
                    <button type="button" onClick={() => cart.setQuantity(index, line.quantity - 1)} aria-label="Reduce quantity">
                      <Minus size={16} strokeWidth={2.5} />
                    </button>
                    <span>{line.quantity}</span>
                    <button type="button" onClick={() => cart.setQuantity(index, line.quantity + 1)} aria-label="Increase quantity">
                      <Plus size={16} strokeWidth={2.5} />
                    </button>
                  </div>
                  <button type="button" className="btn btn-ghost small" onClick={() => cart.remove(index)}>
                    <Trash2 size={15} strokeWidth={2} />
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </section>

          <div className="between card order-total">
            <div><span className="small muted">Restaurant-confirmed total</span><strong>Estimated total</strong></div>
            <strong>
              <Money minor={cart.displayTotalMinor} />
            </strong>
          </div>
          <p className="small muted" style={{margin: 0}}>
            Prices are confirmed by the restaurant when your order is placed.
          </p>

          {error && <Notice tone="error">{error}</Notice>}
          {submitting && <Spinner label="Sending your order" />}

          <div className="checkout-action">
            <button type="button" className="btn btn-gold" onClick={submit} disabled={submitting}>
              {submitting ? 'Sending…' : <>Send order to kitchen · <Money minor={cart.displayTotalMinor} /></>}
            </button>
          </div>
        </>
      )}
    </GuestChrome>
  );
}
