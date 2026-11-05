/**
 * The administration callables behind the branch, menu, staff and settings
 * screens.
 *
 * The point of these is the refusals as much as the writes: a waiter must not
 * be able to reprice a dish, and an administrator must not be able to lock
 * themselves out of the screen they are standing in.
 */
import {describe, it, expect, beforeEach, afterAll} from 'vitest';
import {callFn, expectFailure, restaurant, admin, teardown, signInAs, signOutStaff, makeStaff} from './harness';
import type {
  SaveMenuCategoryResult,
  SaveMenuItemResult,
  CreateBranchResult,
  SaveStaffMemberResult,
} from '../../src/lib/contracts';

const unique = () => Math.random().toString(36).slice(2, 8);

async function asAdmin(): Promise<{uid: string; email: string}> {
  const email = `admin-${unique()}@example.com`;
  const uid = await signInAs(email);
  await makeStaff(uid, 'admin');
  return {uid, email};
}

async function asWaiter(): Promise<string> {
  const uid = await signInAs(`waiter-${unique()}@example.com`);
  await makeStaff(uid, 'waiter');
  return uid;
}

const category = (overrides: Record<string, unknown> = {}) =>
  callFn<Record<string, unknown>, SaveMenuCategoryResult>('saveMenuCategory', {
    categoryId: `cat-${unique()}`,
    name: 'Starters',
    sortOrder: 10,
    published: true,
    ...overrides,
  });

const dish = (categoryId: string, overrides: Record<string, unknown> = {}) =>
  callFn<Record<string, unknown>, SaveMenuItemResult>('saveMenuItem', {
    categoryId,
    name: 'Samosa',
    priceMinor: 4500,
    ...overrides,
  });

beforeEach(signOutStaff);
afterAll(teardown);

describe('menu editing', () => {
  it('refuses a waiter', async () => {
    await asWaiter();
    const failure = await expectFailure('saveMenuCategory', {name: 'Starters'});
    expect(failure.details?.code).toBe('not-admin');
  });

  it('refuses a signed-out caller', async () => {
    const failure = await expectFailure('saveMenuItem', {categoryId: 'x', name: 'Y', priceMinor: 1});
    expect(failure.details?.code).toBe('not-staff');
  });

  it('creates a section and a dish, and reads back exactly what was sent', async () => {
    await asAdmin();
    const section = await category({name: 'Grills', sortOrder: 20});
    expect(section.created).toBe(true);

    const created = await dish(section.categoryId, {
      itemId: `item-${unique()}`,
      name: 'Seekh Kebab',
      description: 'Char-grilled',
      priceMinor: 12550,
      allergens: ['dairy'],
      options: [{id: 'extra', name: 'Extra portion', priceDeltaMinor: 2500}],
    });
    expect(created.created).toBe(true);

    const snapshot = await restaurant().collection('menuItems').doc(created.itemId).get();
    const data = snapshot.data() as Record<string, unknown>;
    expect(data.name).toBe('Seekh Kebab');
    // Money survives the round trip as an integer count of thebe.
    expect(data.priceMinor).toBe(12550);
    expect(data.categoryId).toBe(section.categoryId);
    expect(data.allergens).toEqual(['dairy']);
    expect((data.options as {priceDeltaMinor: number}[])[0].priceDeltaMinor).toBe(2500);
  });

  it('edits an existing dish in place rather than creating a second one', async () => {
    await asAdmin();
    const section = await category();
    const itemId = `item-${unique()}`;
    await dish(section.categoryId, {itemId, priceMinor: 4500});
    const again = await dish(section.categoryId, {itemId, priceMinor: 5000, name: 'Samosa'});

    expect(again.created).toBe(false);
    expect(again.itemId).toBe(itemId);
    const snapshot = await restaurant().collection('menuItems').doc(itemId).get();
    expect(snapshot.data()?.priceMinor).toBe(5000);
  });

  it('records the price it changed from, so a bill can be accounted for afterwards', async () => {
    const {uid} = await asAdmin();
    const section = await category();
    const itemId = `item-${unique()}`;
    await dish(section.categoryId, {itemId, priceMinor: 4500});
    await dish(section.categoryId, {itemId, priceMinor: 9900});

    const entries = await admin()
      .collection('auditLogs')
      .where('action', '==', 'admin.menuItem.updated')
      .where('actorId', '==', uid)
      .get();
    const detail = entries.docs.map((document) => document.data().detail as {priceMinor: number; previousPriceMinor: number | null});
    expect(detail.some((row) => row.priceMinor === 9900 && row.previousPriceMinor === 4500)).toBe(true);
  });

  it('refuses a dish in a section that does not exist', async () => {
    await asAdmin();
    const failure = await expectFailure('saveMenuItem', {
      categoryId: 'no-such-section',
      name: 'Orphan',
      priceMinor: 100,
    });
    expect(failure.details?.code).toBe('invalid-request');
  });

  it('refuses two choices sharing an identifier, which would make pricing ambiguous', async () => {
    await asAdmin();
    const section = await category();
    const failure = await expectFailure('saveMenuItem', {
      categoryId: section.categoryId,
      name: 'Ambiguous',
      priceMinor: 100,
      options: [
        {id: 'same', name: 'A', priceDeltaMinor: 0},
        {id: 'same', name: 'B', priceDeltaMinor: 500},
      ],
    });
    expect(failure.details?.code).toBe('option-invalid');
  });

  it('refuses a price that is not a whole number of thebe', async () => {
    await asAdmin();
    const section = await category();
    const failure = await expectFailure('saveMenuItem', {
      categoryId: section.categoryId,
      name: 'Fractional',
      priceMinor: 12.5,
    });
    expect(failure.details?.code).toBe('invalid-request');
  });

  it('deletes a dish, and refuses to delete it twice', async () => {
    await asAdmin();
    const section = await category();
    const itemId = `item-${unique()}`;
    await dish(section.categoryId, {itemId});

    await callFn('deleteMenuItem', {itemId});
    expect((await restaurant().collection('menuItems').doc(itemId).get()).exists).toBe(false);

    const failure = await expectFailure('deleteMenuItem', {itemId});
    expect(failure.details?.code).toBe('invalid-request');
  });
});

describe('branches', () => {
  it('refuses a waiter', async () => {
    await asWaiter();
    const failure = await expectFailure('createBranch', {branchId: `b-${unique()}`, name: 'Nope'});
    expect(failure.details?.code).toBe('not-admin');
  });

  it('creates a location and makes the creator an administrator of it', async () => {
    const {uid} = await asAdmin();
    const branchId = `branch-${unique()}`;
    const result = await callFn<Record<string, unknown>, CreateBranchResult>('createBranch', {
      branchId,
      name: 'Bukhara Francistown',
      city: 'Francistown',
    });
    expect(result.branchId).toBe(branchId);

    const branch = await admin().collection('branches').doc(branchId).get();
    expect(branch.data()?.name).toBe('Bukhara Francistown');
    expect(branch.data()?.enabled).toBe(true);

    // Without this the branch exists and nobody can put a table in it.
    const staff = await admin().doc(`restaurants/${branchId}/staff/${uid}`).get();
    expect(staff.data()?.role).toBe('admin');
    expect(staff.data()?.active).toBe(true);
  });

  it('refuses an identifier that is already taken', async () => {
    await asAdmin();
    const branchId = `branch-${unique()}`;
    await callFn('createBranch', {branchId, name: 'First'});
    const failure = await expectFailure('createBranch', {branchId, name: 'Second'});
    expect(failure.details?.code).toBe('already-exists');
  });

  it('scopes a dish to the branch it was saved against', async () => {
    await asAdmin();
    const branchId = `branch-${unique()}`;
    await callFn('createBranch', {branchId, name: 'Second location'});

    const section = await category({branchId, name: 'Local specials'});
    const itemId = `item-${unique()}`;
    await dish(section.categoryId, {branchId, itemId, priceMinor: 7700});

    expect((await admin().doc(`restaurants/${branchId}/menuItems/${itemId}`).get()).data()?.priceMinor).toBe(7700);
    // The founding branch's menu is untouched.
    expect((await restaurant().collection('menuItems').doc(itemId).get()).exists).toBe(false);
  });

  it('refuses an administrator of one branch acting on another', async () => {
    await asAdmin();
    const branchId = `branch-${unique()}`;
    await callFn('createBranch', {branchId, name: 'Theirs'});

    // A fresh administrator of the founding branch only.
    await asAdmin();
    const failure = await expectFailure('saveMenuCategory', {branchId, name: 'Intrusion'});
    expect(failure.details?.code).toBe('not-staff');
  });

  it('will not close the founding location, which would leave nowhere to authorize from', async () => {
    await asAdmin();
    await admin().collection('branches').doc('bukhara').set({name: 'Bukhara Gaborone', enabled: true});
    const failure = await expectFailure('updateBranch', {branchId: 'bukhara', enabled: false});
    expect(failure.details?.code).toBe('self-lockout');
  });
});

describe('staff administration', () => {
  it('refuses a waiter', async () => {
    await asWaiter();
    const failure = await expectFailure('saveStaffMember', {
      email: `x-${unique()}@example.com`,
      name: 'X',
      role: 'admin',
    });
    expect(failure.details?.code).toBe('not-admin');
  });

  it('creates an account and returns a temporary password exactly once', async () => {
    await asAdmin();
    const email = `new-${unique()}@example.com`;

    const first = await callFn<Record<string, unknown>, SaveStaffMemberResult>('saveStaffMember', {
      email,
      name: 'New Waiter',
      role: 'waiter',
    });
    expect(first.created).toBe(true);
    expect(first.temporaryPassword).toBeTruthy();

    const second = await callFn<Record<string, unknown>, SaveStaffMemberResult>('saveStaffMember', {
      email,
      name: 'New Waiter',
      role: 'waiter',
    });
    expect(second.created).toBe(false);
    // The password is not re-shown on an ordinary edit; it must be reset
    // deliberately.
    expect(second.temporaryPassword).toBeNull();
    expect(second.uid).toBe(first.uid);

    const reset = await callFn<Record<string, unknown>, SaveStaffMemberResult>('saveStaffMember', {
      email,
      name: 'New Waiter',
      role: 'waiter',
      resetPassword: true,
    });
    expect(reset.temporaryPassword).toBeTruthy();
    expect(reset.temporaryPassword).not.toBe(first.temporaryPassword);
  });

  it('refuses an administrator demoting themselves to waiter', async () => {
    const {email} = await asAdmin();
    const failure = await expectFailure('saveStaffMember', {email, name: 'Me', role: 'waiter', active: true});
    expect(failure.details?.code).toBe('self-lockout');
  });

  it('refuses an administrator deactivating their own account', async () => {
    const {email} = await asAdmin();
    const failure = await expectFailure('saveStaffMember', {email, name: 'Me', role: 'admin', active: false});
    expect(failure.details?.code).toBe('self-lockout');
  });

  it('removes somebody from one location without touching their account', async () => {
    await asAdmin();
    const email = `mover-${unique()}@example.com`;
    const added = await callFn<Record<string, unknown>, SaveStaffMemberResult>('saveStaffMember', {
      email,
      name: 'Mover',
      role: 'waiter',
    });

    await callFn('revokeStaffBranch', {uid: added.uid});
    expect((await restaurant().collection('staff').doc(added.uid).get()).exists).toBe(false);
  });

  it('refuses revoking your own access to the location you are standing in', async () => {
    const {uid} = await asAdmin();
    const failure = await expectFailure('revokeStaffBranch', {uid});
    expect(failure.details?.code).toBe('self-lockout');
  });
});

describe('settings', () => {
  it('refuses a waiter', async () => {
    await asWaiter();
    const failure = await expectFailure('saveRestaurantSettings', {name: 'Renamed'});
    expect(failure.details?.code).toBe('not-admin');
  });

  it('saves the location profile and audits the change', async () => {
    const {uid} = await asAdmin();
    await callFn('saveRestaurantSettings', {
      name: 'Bukhara Gaborone',
      tagline: 'North Indian, since 1998',
      address: 'Plot 1, Gaborone',
      phone: '+267 000 0000',
      serviceNotes: 'Open seven days',
      allergenNotice: 'Prepared in a kitchen handling nuts and dairy.',
    });

    const profile = await restaurant().get();
    expect(profile.data()?.tagline).toBe('North Indian, since 1998');
    expect(profile.data()?.allergenNotice).toContain('nuts');

    const entries = await admin()
      .collection('auditLogs')
      .where('action', '==', 'admin.settings.updated')
      .where('actorId', '==', uid)
      .get();
    expect(entries.size).toBeGreaterThan(0);
  });
});
