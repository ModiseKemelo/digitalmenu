'use client';
/**
 * Staff accounts and access.
 *
 * Membership is per location. Someone who works at two branches holds a record
 * in each, and removing one revokes exactly that location — which is what a
 * transfer actually means. Every privileged call re-reads this record, so
 * deactivating someone takes effect on their next request rather than when
 * their sign-in token happens to expire.
 */
import {useCallback, useEffect, useState} from 'react';
import {collection, getDocs} from 'firebase/firestore';
import {KeyRound, Plus, ShieldCheck, UserMinus} from 'lucide-react';
import {firebase} from '@/lib/firebase-client';
import {useBranchId, useBranches, branchPath} from '@/lib/branch';
import {api, ApiError} from '@/lib/api';
import type {StaffRole} from '@/lib/contracts';
import {BackLink, CardListSkeleton, Notice} from '@/components/ui';
import StaffGuard, {type StaffProfile} from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';
import ConfirmDialog from '@/components/ConfirmDialog';

type Member = {uid: string; name: string; email: string; role: StaffRole; active: boolean};

function Staff({me}: {me: StaffProfile}) {
  const branchId = useBranchId();
  const {branches} = useBranches();
  const branchName = branches?.find((branch) => branch.id === branchId)?.name ?? branchId;

  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{email: string; password: string} | null>(null);
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const load = useCallback(async () => {
    setMembers(null);
    try {
      const snapshot = await getDocs(collection(firebase().db, `${branchPath(branchId)}/staff`));
      setMembers(
        snapshot.docs
          .map((document) => {
            const data = document.data();
            return {
              uid: document.id,
              name: String(data.name ?? document.id),
              email: String(data.email ?? ''),
              role: (data.role === 'admin' ? 'admin' : 'waiter') as StaffRole,
              active: data.active === true,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch {
      setError('Could not read the team for this location.');
      setMembers([]);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (draft: {email: string; name: string; role: StaffRole; active: boolean; resetPassword: boolean}) => {
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      const result = await api.saveStaffMember({branchId, ...draft});
      if (result.temporaryPassword) setIssued({email: draft.email, password: result.temporaryPassword});
      setEditing(null);
      await load();
    } catch (failure) {
      const apiError = failure as ApiError;
      setError(
        apiError.code === 'self-lockout'
          ? 'You cannot remove your own administrator access. Ask another administrator to do it.'
          : apiError.message,
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (member: Member) => {
    setBusy(true);
    setError(null);
    try {
      await api.revokeStaffBranch({branchId, uid: member.uid});
      setRemoving(null);
      await load();
    } catch (failure) {
      setError((failure as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BackLink href="/admin">Administration</BackLink>
      {error && <Notice tone="error">{error}</Notice>}

      {issued && (
        <Notice tone="warn">
          <p style={{margin: '0 0 8px'}}>
            <strong>Temporary password for {issued.email}</strong>
          </p>
          <p className="credential">{issued.password}</p>
          <p className="small" style={{margin: '8px 0 0'}}>
            Shown once and never stored. Hand it over in person and have them change it at first sign-in. If it is
            lost, issue another from the Reset password action.
          </p>
        </Notice>
      )}

      <Notice>
        This team list is for <strong>{branchName}</strong>. Adding somebody who already has an account here gives
        them access to this location without changing their access anywhere else.
      </Notice>

      {!members && <CardListSkeleton count={4} lines={1} label="Loading the team" />}
      {members?.length === 0 && <Notice tone="warn">Nobody is assigned to this location yet.</Notice>}

      <section className="admin-table-list">
        {members?.map((member) => (
          <div key={member.uid} className="card admin-table-row">
            <div>
              <strong>
                {member.name}
                {member.role === 'admin' && (
                  <span className="pill-on">
                    <ShieldCheck size={12} aria-hidden /> Admin
                  </span>
                )}
                {!member.active && <span className="pill-off">Suspended</span>}
              </strong>
              <p className="small muted" style={{margin: '4px 0 0'}}>
                {member.email || member.uid}
                {member.uid === me.uid && ' · this is you'}
              </p>
            </div>
            <div className="row-actions">
              <button type="button" className="btn btn-ghost small" onClick={() => setEditing(member)}>
                Edit
              </button>
              <button
                type="button"
                className="btn btn-ghost small"
                disabled={busy || !member.email}
                onClick={() =>
                  void save({
                    email: member.email,
                    name: member.name,
                    role: member.role,
                    active: member.active,
                    resetPassword: true,
                  })
                }
              >
                <KeyRound size={15} aria-hidden /> Reset password
              </button>
              {member.uid !== me.uid && (
                <button type="button" className="btn btn-ghost small" onClick={() => setRemoving(member)}>
                  <UserMinus size={15} aria-hidden />
                  <span className="sr-only">Remove {member.name} from this location</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      <button type="button" className="btn" onClick={() => setEditing('new')}>
        <Plus size={17} aria-hidden /> Add someone to this location
      </button>

      <MemberDialog value={editing} busy={busy} onCancel={() => setEditing(null)} onSave={save} />

      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        title={removing ? `Remove ${removing.name} from ${branchName}?` : 'Remove from this location?'}
        body={
          <>
            <p>
              Their sign-in and any access they hold at other locations are untouched. They simply stop being able to
              work at this one, from their next request.
            </p>
            <p>Everything they have already done stays in the audit trail under their name.</p>
          </>
        }
        confirmLabel="Remove access here"
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void revoke(removing);
        }}
      />
    </>
  );
}

function MemberDialog({
  value,
  busy,
  onCancel,
  onSave,
}: {
  value: Member | 'new' | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: {email: string; name: string; role: StaffRole; active: boolean; resetPassword: boolean}) => void;
}) {
  const [draft, setDraft] = useState({email: '', name: '', role: 'waiter' as StaffRole, active: true});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = value === 'new' ? 'new' : (value?.uid ?? null);
  const isNew = value === 'new';

  if (value && loadedFor !== key) {
    setLoadedFor(key);
    setDraft(
      isNew
        ? {email: '', name: '', role: 'waiter', active: true}
        : {email: value.email, name: value.name, role: value.role, active: value.active},
    );
  }

  return (
    <ConfirmDialog
      open={value !== null}
      title={isNew ? 'Add someone to this location' : `Edit ${draft.name || 'team member'}`}
      body={
        <div className="dialog-form">
          <label>
            <span>Work email</span>
            <input
              type="email"
              value={draft.email}
              onChange={(event) => setDraft({...draft, email: event.target.value})}
              readOnly={!isNew}
              autoComplete="off"
              maxLength={200}
            />
            {isNew && (
              <small className="muted">
                If they already have an account, this adds them here. If not, an account is created and a temporary
                password is shown once.
              </small>
            )}
          </label>
          <label>
            <span>Name</span>
            <input value={draft.name} onChange={(event) => setDraft({...draft, name: event.target.value})} maxLength={80} />
          </label>
          <label>
            <span>Role</span>
            <select
              value={draft.role}
              onChange={(event) => setDraft({...draft, role: event.target.value as StaffRole})}
            >
              <option value="waiter">Waiter — take orders, serve, take payment</option>
              <option value="admin">Administrator — everything, including this screen</option>
            </select>
          </label>
          <label className="checkline">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => setDraft({...draft, active: event.target.checked})}
            />
            <span>Active — may sign in and work at this location</span>
          </label>
        </div>
      }
      confirmLabel={isNew ? 'Add to this location' : 'Save'}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (draft.email.trim() && draft.name.trim()) {
          onSave({
            email: draft.email.trim(),
            name: draft.name.trim(),
            role: draft.role,
            active: draft.active,
            resetPassword: false,
          });
        }
      }}
    />
  );
}

export default function AdminStaffPage() {
  return (
    <OperationsShell area="admin" title="Staff" subtitle="Who may sign in, what they may do, and where.">
      <div className="stack">
        <StaffGuard requireAdmin>{(me) => <Staff me={me} />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
