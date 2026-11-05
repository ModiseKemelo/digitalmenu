/**
 * Administration callables: branches, menu, staff and settings.
 *
 * These are the write path behind the administration screens. Firestore denies
 * every client write, so a screen that "edits the menu" is really a screen that
 * calls one of these; authorization is re-checked here against the branch the
 * request names, never trusted from the client's branch picker.
 */
import {randomBytes} from 'node:crypto';
import {getAuth} from 'firebase-admin/auth';
import {onCall} from 'firebase-functions/v2/https';
import {
  db,
  refsFor,
  globalRefs,
  callableOptions,
  FieldValue,
  parseInput,
  txOk,
  txFail,
  unwrap,
  fail,
  DEFAULT_BRANCH_ID,
  type TxResult,
} from './runtime';
import {
  saveMenuCategoryInput,
  saveMenuItemInput,
  deleteMenuItemInput,
  createBranchInput,
  updateBranchInput,
  saveStaffMemberInput,
  revokeStaffBranchInput,
  saveRestaurantSettingsInput,
  type SaveMenuCategoryResult,
  type SaveMenuItemResult,
  type DeleteMenuItemResult,
  type CreateBranchResult,
  type UpdateBranchResult,
  type SaveStaffMemberResult,
  type RevokeStaffBranchResult,
  type SaveRestaurantSettingsResult,
} from '../../src/lib/contracts';
import {requireAdmin, audit} from './security';

/* -------------------------------------------------------------------------
 * Menu
 * ---------------------------------------------------------------------- */

export const saveMenuCategory = onCall(callableOptions, async (request): Promise<SaveMenuCategoryResult> => {
  const input = parseInput(saveMenuCategoryInput, request.data);
  const staff = await requireAdmin(request, input.branchId);
  const refs = staff.refs;

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<SaveMenuCategoryResult>> => {
      const ref = input.categoryId ? refs.categories().doc(input.categoryId) : refs.categories().doc();
      const existing = input.categoryId ? await tx.get(ref) : null;
      const created = !existing?.exists;

      tx.set(
        ref,
        {
          name: input.name,
          sortOrder: input.sortOrder,
          published: input.published,
          coverImagePath: input.coverImagePath,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: staff.uid,
        },
        {merge: true},
      );

      audit(tx, {
        branchId: refs.branchId,
        action: created ? 'admin.category.created' : 'admin.category.updated',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: ref.path,
        detail: {name: input.name, published: input.published},
      });

      return txOk({categoryId: ref.id, created});
    }),
  );
});

export const saveMenuItem = onCall(callableOptions, async (request): Promise<SaveMenuItemResult> => {
  const input = parseInput(saveMenuItemInput, request.data);
  const staff = await requireAdmin(request, input.branchId);
  const refs = staff.refs;

  // Two options sharing an id would make an order line ambiguous at pricing
  // time, which is a money bug rather than a cosmetic one.
  const optionIds = new Set(input.options.map((option) => option.id));
  if (optionIds.size !== input.options.length) {
    fail('invalid-argument', 'option-invalid', 'Each choice needs its own identifier');
  }

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<SaveMenuItemResult>> => {
      const ref = input.itemId ? refs.menuItems().doc(input.itemId) : refs.menuItems().doc();
      const existing = input.itemId ? await tx.get(ref) : null;
      const created = !existing?.exists;

      // The category must exist, or the dish lands in a section the guest menu
      // never queries and simply disappears.
      const category = await tx.get(refs.categories().doc(input.categoryId));
      if (!category.exists) return txFail('not-found', 'invalid-request', 'That menu section no longer exists');

      const previousPrice = existing?.exists ? ((existing.data() as {priceMinor?: number}).priceMinor ?? null) : null;

      tx.set(
        ref,
        {
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
          priceMinor: input.priceMinor,
          available: input.available,
          published: input.published,
          sortOrder: input.sortOrder,
          allergens: input.allergens,
          options: input.options,
          primaryImagePath: input.primaryImagePath,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: staff.uid,
        },
        {merge: true},
      );

      audit(tx, {
        branchId: refs.branchId,
        action: created ? 'admin.menuItem.created' : 'admin.menuItem.updated',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: ref.path,
        // Price history is the part an administrator is most likely to need to
        // account for afterwards, so the change is recorded, not just the fact
        // that an edit happened.
        detail: {name: input.name, priceMinor: input.priceMinor, previousPriceMinor: previousPrice},
      });

      return txOk({itemId: ref.id, created});
    }),
  );
});

export const deleteMenuItem = onCall(callableOptions, async (request): Promise<DeleteMenuItemResult> => {
  const input = parseInput(deleteMenuItemInput, request.data);
  const staff = await requireAdmin(request, input.branchId);
  const refs = staff.refs;

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<DeleteMenuItemResult>> => {
      const ref = refs.menuItems().doc(input.itemId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return txFail('not-found', 'invalid-request', 'That dish has already been removed');
      const data = snapshot.data() as {name?: string};

      // Safe to delete: an order snapshots the name, price and options it was
      // placed at, so past bills do not depend on this document surviving.
      tx.delete(ref);
      audit(tx, {
        branchId: refs.branchId,
        action: 'admin.menuItem.deleted',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: ref.path,
        detail: {name: data.name ?? input.itemId},
      });

      return txOk({itemId: input.itemId});
    }),
  );
});

/* -------------------------------------------------------------------------
 * Branches
 * ---------------------------------------------------------------------- */

/**
 * Creating a branch is authorized against the founding branch, which acts as
 * head office. There is no other anchor available: the branch being created
 * has no staff yet, so it cannot authorize anything itself.
 */
export const createBranch = onCall(callableOptions, async (request): Promise<CreateBranchResult> => {
  const input = parseInput(createBranchInput, request.data);
  const staff = await requireAdmin(request, DEFAULT_BRANCH_ID);

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<CreateBranchResult>> => {
      const branchRef = globalRefs.branch(input.branchId);
      const existing = await tx.get(branchRef);
      if (existing.exists) return txFail('failed-precondition', 'already-exists', 'A branch with that identifier already exists');

      const newRefs = refsFor(input.branchId);
      const restaurantSnapshot = await tx.get(newRefs.restaurant());
      if (restaurantSnapshot.exists) {
        return txFail('failed-precondition', 'already-exists', 'That identifier is already in use by another location');
      }

      tx.set(branchRef, {
        name: input.name,
        city: input.city,
        enabled: true,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: staff.uid,
      });
      tx.set(newRefs.restaurant(), {
        name: input.name,
        tagline: '',
        address: input.city,
        phone: '',
        serviceNotes: '',
        allergenNotice: '',
        createdAt: FieldValue.serverTimestamp(),
      });

      // The creator is made an administrator of the new branch. Without this
      // the branch exists but nobody — including whoever just created it — can
      // add a table, a dish or another member of staff to it.
      tx.set(newRefs.staff(staff.uid), {
        name: staff.name,
        role: 'admin',
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: staff.uid,
      });

      audit(tx, {
        branchId: input.branchId,
        action: 'admin.branch.created',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: branchRef.path,
        detail: {name: input.name, city: input.city},
      });

      return txOk({branchId: input.branchId});
    }),
  );
});

export const updateBranch = onCall(callableOptions, async (request): Promise<UpdateBranchResult> => {
  const input = parseInput(updateBranchInput, request.data);
  const staff = await requireAdmin(request, input.branchId);

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<UpdateBranchResult>> => {
      const branchRef = globalRefs.branch(input.branchId);
      const snapshot = await tx.get(branchRef);
      if (!snapshot.exists) return txFail('not-found', 'invalid-request', 'That branch does not exist');

      // Closing the founding branch would take the whole restaurant offline
      // and leave nowhere to authorize creating another one.
      if (input.enabled === false && input.branchId === DEFAULT_BRANCH_ID) {
        return txFail('failed-precondition', 'self-lockout', 'The founding location cannot be closed from here');
      }

      const patch: Record<string, unknown> = {updatedAt: FieldValue.serverTimestamp(), updatedBy: staff.uid};
      if (input.name !== undefined) patch.name = input.name;
      if (input.city !== undefined) patch.city = input.city;
      if (input.enabled !== undefined) patch.enabled = input.enabled;

      tx.set(branchRef, patch, {merge: true});
      if (input.name !== undefined) {
        tx.set(refsFor(input.branchId).restaurant(), {name: input.name}, {merge: true});
      }

      audit(tx, {
        branchId: input.branchId,
        action: 'admin.branch.updated',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: branchRef.path,
        detail: {name: input.name ?? null, enabled: input.enabled ?? null},
      });

      return txOk({branchId: input.branchId});
    }),
  );
});

/* -------------------------------------------------------------------------
 * Staff
 * ---------------------------------------------------------------------- */

/** Printed once, never stored: Firebase Auth keeps only a hash of it. */
function temporaryPassword(): string {
  return randomBytes(9).toString('base64url');
}

export const saveStaffMember = onCall(callableOptions, async (request): Promise<SaveStaffMemberResult> => {
  const input = parseInput(saveStaffMemberInput, request.data);
  const staff = await requireAdmin(request, input.branchId);
  const refs = staff.refs;

  const auth = getAuth();
  const existingUser = await auth.getUserByEmail(input.email).catch(() => null);

  // An administrator who deactivates or demotes their own account loses access
  // to this screen on their very next request, with no way back in. Refusing is
  // kinder than a support call.
  if (existingUser?.uid === staff.uid && (input.active === false || input.role !== 'admin')) {
    fail('failed-precondition', 'self-lockout', 'You cannot remove your own administrator access');
  }

  let password: string | null = null;
  let user = existingUser;
  if (!user) {
    password = temporaryPassword();
    user = await auth.createUser({email: input.email, password, displayName: input.name, emailVerified: false});
  } else if (input.resetPassword) {
    password = temporaryPassword();
    await auth.updateUser(user.uid, {password});
  }

  const uid = user.uid;
  const created = !existingUser;

  unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<null>> => {
      const ref = refs.staff(uid);
      const before = await tx.get(ref);

      tx.set(
        ref,
        {
          name: input.name,
          email: input.email,
          role: input.role,
          active: input.active,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: staff.uid,
        },
        {merge: true},
      );

      audit(tx, {
        branchId: refs.branchId,
        action: before.exists ? 'admin.staff.updated' : 'admin.staff.added',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: ref.path,
        detail: {email: input.email, role: input.role, active: input.active, passwordReset: password !== null},
      });

      return txOk(null);
    }),
  );

  return {uid, created, temporaryPassword: password};
});

/**
 * Removes a person from one branch without touching their account or their
 * access to any other branch. Membership is per branch by design, so this is
 * the narrow revocation an administrator actually wants when someone transfers.
 */
export const revokeStaffBranch = onCall(callableOptions, async (request): Promise<RevokeStaffBranchResult> => {
  const input = parseInput(revokeStaffBranchInput, request.data);
  const staff = await requireAdmin(request, input.branchId);
  const refs = staff.refs;

  if (input.uid === staff.uid) {
    fail('failed-precondition', 'self-lockout', 'You cannot remove your own access to this location');
  }

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<RevokeStaffBranchResult>> => {
      const ref = refs.staff(input.uid);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return txFail('not-found', 'invalid-request', 'That person is not assigned to this location');
      const data = snapshot.data() as {email?: string};

      tx.delete(ref);
      audit(tx, {
        branchId: refs.branchId,
        action: 'admin.staff.revoked',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: ref.path,
        detail: {email: data.email ?? input.uid},
      });

      return txOk({uid: input.uid});
    }),
  );
});

/* -------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------- */

export const saveRestaurantSettings = onCall(callableOptions, async (request): Promise<SaveRestaurantSettingsResult> => {
  const input = parseInput(saveRestaurantSettingsInput, request.data);
  const staff = await requireAdmin(request, input.branchId);
  const refs = staff.refs;

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<SaveRestaurantSettingsResult>> => {
      const ref = refs.restaurant();
      // Read before write so a concurrent edit by another administrator is
      // retried rather than silently overwritten.
      await tx.get(ref);

      tx.set(
        ref,
        {
          name: input.name,
          tagline: input.tagline,
          address: input.address,
          phone: input.phone,
          serviceNotes: input.serviceNotes,
          allergenNotice: input.allergenNotice,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: staff.uid,
        },
        {merge: true},
      );

      audit(tx, {
        branchId: refs.branchId,
        action: 'admin.settings.updated',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: ref.path,
        detail: {name: input.name},
      });

      return txOk({branchId: refs.branchId});
    }),
  );
});
