# 01 — Product requirements

## Vision
A premium, image-led printed-menu replacement for Bukhara Restaurant with table-specific QR access, guest ordering, waiter management, and manual settlement.

## Roles
Guest: scan QR, browse categories/items, customize cart, submit order, see current table status, request bill.
Waiter: authenticated table QR scan, live queue, add orders, mark handoff/preparation/ready/served, record payments, close settled table.
Admin: maintain menu/photos/categories/prices, tables/QR tokens, staff, reports and audit history.

## Core acceptance criteria
1. Every one of 20 table QR codes resolves only its assigned table.
2. Published items have approved photographs, description, price and availability.
3. Multiple devices can submit distinct orders to the same dining session without overwrites.
4. Server validates every price, option, quantity, table capability and request idempotency key.
5. Orders reach staff in real time without refresh, with audible/persistent alert fallback.
6. Waiters can add orders, change permitted statuses and record partial cash/card payments.
7. Closing requires zero balance or manager-authorized exception; history retained.
8. Guests cannot read other tables, previous sessions or payment records.
9. Staff actions are attributed and auditable.
10. Network failures never show false order success.

## Out of scope
Digital payment processing, kitchen display, printer integration, delivery, inventory, reservations, loyalty and multi-branch UI.

## Success metrics
Menu usable under 3s on typical 4G; 99.5% availability target; order notification target <2s on healthy network; 100% recorded payments reconcilable; 100% published items with approved photos.
