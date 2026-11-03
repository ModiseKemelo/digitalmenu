# 00 — Start here

## Decisions locked (2026-11-03)
- Restaurant: Bukhara, Gaborone, Botswana; 20 tables initially.
- Direct guest orders; waiters relay orders to kitchen.
- Waiters record manual cash/card payments and close settled tables.
- Existing approved photography plus new photographs.
- Firebase backend; Next.js mobile-first web app; no guest login.

## What is included now (updated 2026-11-03)
The secure ordering core and the interfaces on top of it: QR token minting and
resolution, short-lived guest capabilities, server-side pricing, idempotent
transactional ordering, the guest menu/cart/status/bill screens, staff sign-in
with a live order dashboard, manual payments with reversals and transactional
table closing, table/QR administration, menu and staff provisioning scripts, and
83 automated tests. See CHANGELOG.md.

## What is NOT implemented
The real Bukhara menu and photographs (not supplied), an image variant pipeline,
a camera QR scanner, a UI for waiter-entered orders, admin screens for menu,
media, staff and reporting, a dedicated Firebase project, device and load
testing, staff training and production release. Track these in TRACKING.md. Do
not mark complete without test evidence.

## Required inputs from Bukhara
Approved logo/colors; full item/category menu with BWP prices, allergens and options; image rights and photos; exact table labels; staff names/roles; manager for sign-off; preferred domain; manual payment handling SOP; cancellation/discount policy; opening hours.
