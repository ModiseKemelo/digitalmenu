'use client';
/**
 * Guest cart.
 *
 * Holds item ids, options, quantities and a display-only price snapshot. The
 * displayed total is never sent to the server, which reprices the whole cart
 * from Firestore when the order is submitted.
 */
import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';
import {MAX_LINE_QUANTITY, type OrderLineInput} from './contracts';

export type CartLine = OrderLineInput & {
  /** For display only; the server prices the order independently. */
  displayName: string;
  displayUnitPriceMinor: number;
  optionLabels: string[];
};

type CartState = {
  lines: CartLine[];
  add: (line: CartLine) => void;
  setQuantity: (index: number, quantity: number) => void;
  remove: (index: number) => void;
  clear: () => void;
  count: number;
  displayTotalMinor: number;
};

const CartContext = createContext<CartState | null>(null);
const STORAGE_KEY = 'bukhara.cart';

const lineKey = (line: CartLine) => `${line.itemId}|${[...line.optionIds].sort().join(',')}|${line.notes}`;

export function CartProvider({children}: {children: ReactNode}) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Survive an accidental reload mid-order, but only for this tab/session.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) setLines(JSON.parse(raw) as CartLine[]);
    } catch {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines, hydrated]);

  const add = useCallback((line: CartLine) => {
    setLines((current) => {
      const index = current.findIndex((existing) => lineKey(existing) === lineKey(line));
      if (index === -1) return [...current, line];
      const next = [...current];
      next[index] = {...next[index], quantity: Math.min(MAX_LINE_QUANTITY, next[index].quantity + line.quantity)};
      return next;
    });
  }, []);

  const setQuantity = useCallback((index: number, quantity: number) => {
    setLines((current) => {
      if (quantity < 1) return current.filter((_, i) => i !== index);
      return current.map((line, i) => (i === index ? {...line, quantity: Math.min(MAX_LINE_QUANTITY, quantity)} : line));
    });
  }, []);

  const remove = useCallback((index: number) => {
    setLines((current) => current.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartState>(
    () => ({
      lines,
      add,
      setQuantity,
      remove,
      clear,
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      displayTotalMinor: lines.reduce((sum, line) => sum + line.displayUnitPriceMinor * line.quantity, 0),
    }),
    [lines, add, setQuantity, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside a CartProvider');
  return context;
}

/** The payload the server accepts: ids, options, quantities and notes only. */
export function toOrderLines(lines: CartLine[]): OrderLineInput[] {
  return lines.map(({itemId, quantity, optionIds, notes}) => ({itemId, quantity, optionIds, notes}));
}
