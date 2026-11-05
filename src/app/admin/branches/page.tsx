'use client';
/**
 * Branches: the restaurant's locations.
 *
 * A branch owns its own tables, menu, staff and sessions. Printed QR codes
 * carry the branch they were minted for, so adding a location never disturbs
 * an existing one.
 */
import {useState} from 'react';
import {Building2, Plus} from 'lucide-react';
import {api, ApiError} from '@/lib/api';
import {RESTAURANT_ID} from '@/lib/firebase-client';
import {useBranchId, useBranches, setBranchId, type Branch} from '@/lib/branch';
import {slugify} from '@/lib/admin-format';
import {BackLink, CardListSkeleton, Notice} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';
import ConfirmDialog from '@/components/ConfirmDialog';

function Branches() {
  const {branches, failed, reload} = useBranches();
  const activeBranchId = useBranchId();

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [identifierEdited, setIdentifierEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [closing, setClosing] = useState<Branch | null>(null);

  const suggestedId = identifierEdited ? identifier : slugify(name, '');

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const branchId = suggestedId;
    if (!branchId) {
      setError('Give the location a name first.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.createBranch({branchId, name: name.trim(), city: city.trim()});
      setDone(`${name.trim()} is open. You are now an administrator of it.`);
      setName('');
      setCity('');
      setIdentifier('');
      setIdentifierEdited(false);
      reload();
    } catch (failure) {
      const apiError = failure as ApiError;
      setError(
        apiError.code === 'already-exists'
          ? 'A location with that identifier already exists. Choose another.'
          : apiError.message,
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async (branch: Branch, patch: {name?: string; city?: string; enabled?: boolean}) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateBranch({branchId: branch.id, ...patch});
      setEditing(null);
      setClosing(null);
      reload();
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
      {done && <Notice tone="ok">{done}</Notice>}
      {failed && (
        <Notice tone="warn">
          Could not read the list of locations. Only the founding location is shown, which may not be all of them.
        </Notice>
      )}

      <Notice>
        Each location keeps its own tables, menu, prices and staff. QR codes already printed for one location keep
        working exactly as before — a code carries the location it was issued for.
      </Notice>

      {!branches && <CardListSkeleton count={2} lines={2} label="Loading locations" />}

      <section className="admin-table-list">
        {(branches ?? []).map((branch) => (
          <div key={branch.id} className="card admin-table-row">
            <div>
              <strong>
                {branch.name}
                {branch.id === activeBranchId && <span className="pill-on">Editing</span>}
              </strong>
              <p className="small muted" style={{margin: '4px 0 0'}}>
                {branch.id}
                {branch.city && ` · ${branch.city}`} · {branch.enabled ? 'open' : 'closed'}
                {branch.id === RESTAURANT_ID && ' · founding location'}
              </p>
            </div>
            <div className="row-actions">
              {branch.id !== activeBranchId && (
                <button type="button" className="btn btn-ghost small" onClick={() => setBranchId(branch.id)}>
                  Switch to
                </button>
              )}
              <button type="button" className="btn btn-ghost small" onClick={() => setEditing(branch)}>
                Edit
              </button>
              {branch.id !== RESTAURANT_ID && (
                <button
                  type="button"
                  className="btn btn-ghost small"
                  onClick={() => (branch.enabled ? setClosing(branch) : void save(branch, {enabled: true}))}
                >
                  {branch.enabled ? 'Close' : 'Reopen'}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      <form className="card admin-form" onSubmit={create}>
        <h2>
          <Plus size={18} aria-hidden /> Add a location
        </h2>
        <div className="field-row">
          <label>
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Bukhara Francistown"
              required
              maxLength={80}
            />
          </label>
          <label>
            <span>City</span>
            <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Francistown" maxLength={80} />
          </label>
        </div>
        <label>
          <span>Identifier</span>
          <input
            value={suggestedId}
            onChange={(event) => {
              setIdentifierEdited(true);
              setIdentifier(slugify(event.target.value, ''));
            }}
            placeholder="bukhara-francistown"
            pattern="[A-Za-z0-9_-]+"
            maxLength={60}
            required
          />
          <small className="muted">
            Used in every document path for this location. It cannot be changed afterwards, so keep it short and
            permanent.
          </small>
        </label>
        <button type="submit" className="btn" disabled={busy || !suggestedId}>
          <Building2 size={17} aria-hidden /> {busy ? 'Opening…' : 'Open this location'}
        </button>
      </form>

      <EditDialog branch={editing} busy={busy} onCancel={() => setEditing(null)} onSave={save} />

      <ConfirmDialog
        open={closing !== null}
        tone="danger"
        title={closing ? `Close ${closing.name}?` : 'Close this location?'}
        body={
          <>
            <p>
              Its tables, orders and history are kept. It simply stops appearing as somewhere currently trading, and
              you can reopen it here at any time.
            </p>
            <p>Guests already seated there are not interrupted.</p>
          </>
        }
        confirmLabel="Close the location"
        busy={busy}
        onCancel={() => setClosing(null)}
        onConfirm={() => {
          if (closing) void save(closing, {enabled: false});
        }}
      />
    </>
  );
}

function EditDialog({
  branch,
  busy,
  onCancel,
  onSave,
}: {
  branch: Branch | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (branch: Branch, patch: {name: string; city: string}) => void;
}) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Seeding from props during render, keyed by the branch being opened, keeps
  // the dialog in step without an effect that would flash the previous values.
  if (branch && loadedFor !== branch.id) {
    setLoadedFor(branch.id);
    setName(branch.name);
    setCity(branch.city);
  }

  return (
    <ConfirmDialog
      open={branch !== null}
      title={branch ? `Edit ${branch.name}` : 'Edit location'}
      body={
        <div className="dialog-form">
          <label>
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </label>
          <label>
            <span>City</span>
            <input value={city} onChange={(event) => setCity(event.target.value)} maxLength={80} />
          </label>
        </div>
      }
      confirmLabel="Save"
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (branch && name.trim()) onSave(branch, {name: name.trim(), city: city.trim()});
      }}
    />
  );
}

export default function AdminBranchesPage() {
  return (
    <OperationsShell
      area="admin"
      title="Branches"
      subtitle="Every location, its own tables, menu and team."
    >
      <div className="stack">
        <StaffGuard requireAdmin>{() => <Branches />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
