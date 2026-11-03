/**
 * Firestore security rules tests (docs/04-SECURITY-AND-DATA.md, "Rules tests
 * required"). These assert the rules directly, with no Cloud Functions in the
 * way: a client must not be able to write order or payment data at all, and
 * must not be able to read other parties' or staff-only data.
 */
import {describe, it, beforeAll, afterAll, beforeEach} from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {readFileSync} from 'node:fs';
import {doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs} from 'firebase/firestore';

const RESTAURANT = 'bukhara';
let env: RulesTestEnvironment;

const path = {
  menuItem: (id: string) => `restaurants/${RESTAURANT}/menuItems/${id}`,
  category: (id: string) => `restaurants/${RESTAURANT}/categories/${id}`,
  table: (id: string) => `restaurants/${RESTAURANT}/tables/${id}`,
  session: (id: string) => `restaurants/${RESTAURANT}/sessions/${id}`,
  order: (s: string, o: string) => `restaurants/${RESTAURANT}/sessions/${s}/orders/${o}`,
  payment: (s: string, p: string) => `restaurants/${RESTAURANT}/sessions/${s}/payments/${p}`,
  staff: (uid: string) => `restaurants/${RESTAURANT}/staff/${uid}`,
  audit: (id: string) => `restaurants/${RESTAURANT}/auditLogs/${id}`,
  qrToken: (hash: string) => `restaurants/${RESTAURANT}/qrTokens/${hash}`,
  capability: (hash: string) => `restaurants/${RESTAURANT}/guestCapabilities/${hash}`,
  idempotency: (key: string) => `restaurants/${RESTAURANT}/idempotency/${key}`,
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'bukhara-rules-test',
    firestore: {rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085},
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed through the privileged context, which bypasses rules, exactly as the
  // Cloud Functions do with the Admin SDK.
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, path.menuItem('published-item')), {name: 'Curry', priceMinor: 12500, published: true, available: true});
    await setDoc(doc(db, path.menuItem('draft-item')), {name: 'Draft', priceMinor: 100, published: false, available: true});
    await setDoc(doc(db, path.category('mains')), {name: 'Mains', published: true});
    await setDoc(doc(db, path.category('hidden')), {name: 'Hidden', published: false});
    await setDoc(doc(db, path.table('TBL-001')), {label: 'Table 01', enabled: true, qrTokenHash: 'hash'});
    await setDoc(doc(db, path.session('S1')), {tableId: 'TBL-001', status: 'open', balanceMinor: 0});
    await setDoc(doc(db, path.order('S1', 'O1')), {status: 'received', totalMinor: 12500, guestId: 'g1'});
    await setDoc(doc(db, path.payment('S1', 'P1')), {amountMinor: 12500, method: 'cash'});
    await setDoc(doc(db, path.audit('A1')), {action: 'test'});
    await setDoc(doc(db, path.qrToken('hash')), {tableId: 'TBL-001', revoked: false});
    await setDoc(doc(db, path.capability('caphash')), {sessionId: 'S1', revoked: false});
    await setDoc(doc(db, path.idempotency('key1')), {result: {}});
    await setDoc(doc(db, path.staff('waiter-uid')), {name: 'Waiter', role: 'waiter', active: true});
    await setDoc(doc(db, path.staff('admin-uid')), {name: 'Admin', role: 'admin', active: true});
    await setDoc(doc(db, path.staff('exwaiter-uid')), {name: 'Ex', role: 'waiter', active: false});
  });
});

const guest = () => env.unauthenticatedContext().firestore();
const signedIn = (uid: string) => env.authenticatedContext(uid).firestore();

describe('menu reads', () => {
  it('lets anyone read a published item and category', async () => {
    await assertSucceeds(getDoc(doc(guest(), path.menuItem('published-item'))));
    await assertSucceeds(getDoc(doc(guest(), path.category('mains'))));
  });

  // An unpublished item must stay hidden from guests.
  it('hides unpublished menu data from guests', async () => {
    await assertFails(getDoc(doc(guest(), path.menuItem('draft-item'))));
    await assertFails(getDoc(doc(guest(), path.category('hidden'))));
  });

  it('shows unpublished menu data to active staff', async () => {
    await assertSucceeds(getDoc(doc(signedIn('waiter-uid'), path.menuItem('draft-item'))));
  });
});

describe('client writes are denied everywhere', () => {
  // The only write path is a Cloud Function; no client may write directly.
  it('refuses order writes from a guest, a waiter and an admin', async () => {
    for (const db of [guest(), signedIn('waiter-uid'), signedIn('admin-uid')]) {
      await assertFails(setDoc(doc(db, path.order('S1', 'forged')), {status: 'served', totalMinor: 0}));
      await assertFails(updateDoc(doc(db, path.order('S1', 'O1')), {status: 'served'}));
      await assertFails(deleteDoc(doc(db, path.order('S1', 'O1'))));
    }
  });

  it('refuses payment writes, including by an admin', async () => {
    for (const db of [guest(), signedIn('waiter-uid'), signedIn('admin-uid')]) {
      await assertFails(setDoc(doc(db, path.payment('S1', 'forged')), {amountMinor: 999999, method: 'cash'}));
      await assertFails(updateDoc(doc(db, path.payment('S1', 'P1')), {amountMinor: 1}));
    }
  });

  it('refuses menu, table and session writes', async () => {
    const db = signedIn('admin-uid');
    await assertFails(updateDoc(doc(db, path.menuItem('published-item')), {priceMinor: 1}));
    await assertFails(updateDoc(doc(db, path.table('TBL-001')), {enabled: false}));
    await assertFails(updateDoc(doc(db, path.session('S1')), {status: 'closed'}));
  });

  it('refuses audit log writes, so history cannot be edited away', async () => {
    await assertFails(setDoc(doc(signedIn('admin-uid'), path.audit('forged')), {action: 'forged'}));
    await assertFails(deleteDoc(doc(signedIn('admin-uid'), path.audit('A1'))));
  });

  it('refuses staff writes, so nobody can grant themselves a role', async () => {
    await assertFails(setDoc(doc(signedIn('waiter-uid'), path.staff('waiter-uid')), {role: 'admin', active: true}));
    await assertFails(setDoc(doc(signedIn('admin-uid'), path.staff('new-uid')), {role: 'admin', active: true}));
  });
});

describe('guest cannot read protected data', () => {
  // T08: a guest must not read orders, payments, sessions or tables directly.
  it('denies order, payment, session and table reads', async () => {
    const db = guest();
    await assertFails(getDoc(doc(db, path.order('S1', 'O1'))));
    await assertFails(getDoc(doc(db, path.payment('S1', 'P1'))));
    await assertFails(getDoc(doc(db, path.session('S1'))));
    await assertFails(getDoc(doc(db, path.table('TBL-001'))));
    await assertFails(getDocs(collection(db, `restaurants/${RESTAURANT}/sessions/S1/orders`)));
  });

  it('denies reads of staff records and audit logs', async () => {
    await assertFails(getDoc(doc(guest(), path.staff('waiter-uid'))));
    await assertFails(getDoc(doc(guest(), path.audit('A1'))));
  });

  // Secret material must be unreadable even by staff: a leaked session would
  // otherwise let someone forge table access or impersonate a guest.
  it('denies everyone reads of QR hashes, capabilities and idempotency records', async () => {
    for (const db of [guest(), signedIn('waiter-uid'), signedIn('admin-uid')]) {
      await assertFails(getDoc(doc(db, path.qrToken('hash'))));
      await assertFails(getDoc(doc(db, path.capability('caphash'))));
      await assertFails(getDoc(doc(db, path.idempotency('key1'))));
    }
  });
});

describe('staff reads', () => {
  it('lets an active waiter read the live service data', async () => {
    const db = signedIn('waiter-uid');
    await assertSucceeds(getDoc(doc(db, path.session('S1'))));
    await assertSucceeds(getDoc(doc(db, path.order('S1', 'O1'))));
    await assertSucceeds(getDoc(doc(db, path.payment('S1', 'P1'))));
    await assertSucceeds(getDoc(doc(db, path.table('TBL-001'))));
  });

  // T15: a deactivated waiter loses access immediately.
  it('denies a deactivated waiter', async () => {
    const db = signedIn('exwaiter-uid');
    await assertFails(getDoc(doc(db, path.session('S1'))));
    await assertFails(getDoc(doc(db, path.order('S1', 'O1'))));
  });

  it('denies a signed-in user with no staff record', async () => {
    await assertFails(getDoc(doc(signedIn('stranger-uid'), path.session('S1'))));
  });

  it('limits audit log reads to administrators', async () => {
    await assertFails(getDoc(doc(signedIn('waiter-uid'), path.audit('A1'))));
    await assertSucceeds(getDoc(doc(signedIn('admin-uid'), path.audit('A1'))));
  });

  it('lets a waiter read only their own staff record', async () => {
    await assertSucceeds(getDoc(doc(signedIn('waiter-uid'), path.staff('waiter-uid'))));
    await assertFails(getDoc(doc(signedIn('waiter-uid'), path.staff('admin-uid'))));
    await assertSucceeds(getDoc(doc(signedIn('admin-uid'), path.staff('waiter-uid'))));
  });
});
