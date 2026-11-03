/**
 * Server-side pricing. The client sends item ids, option ids and quantities and
 * nothing else; every price, name and line total in a stored order is read from
 * Firestore here. Client-supplied money is never accepted (docs/09).
 */
import type {Transaction} from 'firebase-admin/firestore';
import {refs, txOk, txFail, type TxResult} from './runtime';
import {lineTotal, mergeLines, orderTotal, unitPriceWithOptions} from '../../src/lib/order-domain';
import type {OrderLineInput, OrderLineSnapshot} from '../../src/lib/contracts';

type MenuOption = {id: string; name: string; priceDeltaMinor: number; available?: boolean};

type MenuItemDoc = {
  name: string;
  priceMinor: number;
  available: boolean;
  published: boolean;
  categoryId: string;
  options?: MenuOption[];
};

/**
 * Prices a cart inside the caller's transaction, so an item whose price or
 * availability changes mid-request cannot be ordered at the stale value.
 */
export async function priceOrderLines(
  tx: Transaction,
  lines: OrderLineInput[],
): Promise<TxResult<{items: OrderLineSnapshot[]; totalMinor: number}>> {
  const merged = mergeLines(lines);
  const snapshots = await tx.getAll(...merged.map((line) => refs.menuItems().doc(line.itemId)));

  const items: OrderLineSnapshot[] = [];

  for (const [index, line] of merged.entries()) {
    const snapshot = snapshots[index];
    if (!snapshot.exists) {
      return txFail('failed-precondition', 'item-unavailable', `Item ${line.itemId} is not on the menu`);
    }
    const item = snapshot.data() as MenuItemDoc;

    // T03: an unpublished or sold-out item is not orderable, whatever the client sends.
    if (item.published !== true) {
      return txFail('failed-precondition', 'item-unavailable', `Item ${line.itemId} is not published`);
    }
    if (item.available !== true) {
      return txFail('failed-precondition', 'item-unavailable', `${item.name} is currently unavailable`);
    }

    const catalogue = item.options ?? [];
    const optionsSnapshot: OrderLineSnapshot['optionsSnapshot'] = [];
    for (const optionId of line.optionIds) {
      const option = catalogue.find((candidate) => candidate.id === optionId);
      if (!option) {
        return txFail('failed-precondition', 'option-invalid', `Option ${optionId} is not valid for ${item.name}`);
      }
      if (option.available === false) {
        return txFail('failed-precondition', 'option-invalid', `Option ${option.name} is unavailable`);
      }
      optionsSnapshot.push({id: option.id, name: option.name, priceDeltaMinor: option.priceDeltaMinor});
    }

    const unitPriceMinor = unitPriceWithOptions(
      item.priceMinor,
      optionsSnapshot.map((option) => option.priceDeltaMinor),
    );

    items.push({
      itemId: line.itemId,
      name: item.name,
      unitPriceMinor,
      quantity: line.quantity,
      optionIds: line.optionIds,
      optionsSnapshot,
      notes: line.notes,
      lineTotalMinor: lineTotal(unitPriceMinor, line.quantity),
    });
  }

  return txOk({items, totalMinor: orderTotal(items)});
}
