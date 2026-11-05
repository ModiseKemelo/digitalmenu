'use client';
/**
 * Restaurant profile and the audit trail.
 *
 * The audit trail is append-only and written by the server inside the same
 * transaction as the change it describes, so it cannot disagree with what
 * actually happened, and nothing on this screen can edit it.
 */
import {useCallback, useEffect, useState} from 'react';
import {collection, doc, getDoc, getDocs, limit, orderBy, query, where} from 'firebase/firestore';
import {ScrollText} from 'lucide-react';
import {firebase} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import {api, ApiError} from '@/lib/api';
import {BackLink, CardListSkeleton, Notice} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';

type Profile = {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  serviceNotes: string;
  allergenNotice: string;
};

const EMPTY: Profile = {name: '', tagline: '', address: '', phone: '', serviceNotes: '', allergenNotice: ''};

type AuditEntry = {
  id: string;
  action: string;
  actorId: string;
  actorType: string;
  atMs: number;
  targetPath: string;
  detail: Record<string, unknown>;
};

const AUDIT_PAGE = 40;

function Settings() {
  const branchId = useBranchId();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setProfile(null);
    try {
      const snapshot = await getDoc(doc(firebase().db, branchPath(branchId)));
      const data = snapshot.exists() ? snapshot.data() : {};
      setProfile({
        name: String(data.name ?? 'Bukhara Restaurant'),
        tagline: String(data.tagline ?? ''),
        address: String(data.address ?? ''),
        phone: String(data.phone ?? ''),
        serviceNotes: String(data.serviceNotes ?? ''),
        allergenNotice: String(data.allergenNotice ?? ''),
      });
    } catch {
      setError('Could not read this location’s profile.');
      setProfile(EMPTY);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.saveRestaurantSettings({branchId, ...profile});
      setDone('Saved.');
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

      {!profile && <CardListSkeleton count={2} lines={3} label="Loading settings" />}

      {profile && (
        <form className="card admin-form" onSubmit={save}>
          <h2>Location profile</h2>
          <p className="small muted">
            This is public information: the guest menu is readable without signing in, so put nothing here you would
            not print on a table card.
          </p>

          <div className="field-row">
            <label>
              <span>Name</span>
              <input
                value={profile.name}
                onChange={(event) => setProfile({...profile, name: event.target.value})}
                required
                maxLength={120}
              />
            </label>
            <label>
              <span>Telephone</span>
              <input
                value={profile.phone}
                onChange={(event) => setProfile({...profile, phone: event.target.value})}
                maxLength={40}
              />
            </label>
          </div>

          <label>
            <span>Tagline</span>
            <input
              value={profile.tagline}
              onChange={(event) => setProfile({...profile, tagline: event.target.value})}
              maxLength={160}
            />
          </label>

          <label>
            <span>Address</span>
            <input
              value={profile.address}
              onChange={(event) => setProfile({...profile, address: event.target.value})}
              maxLength={240}
            />
          </label>

          <label>
            <span>Service notes</span>
            <textarea
              value={profile.serviceNotes}
              onChange={(event) => setProfile({...profile, serviceNotes: event.target.value})}
              rows={3}
              maxLength={600}
            />
            <small className="muted">Shown to guests alongside the menu — opening hours, service charge, and so on.</small>
          </label>

          <label>
            <span>Allergen notice</span>
            <textarea
              value={profile.allergenNotice}
              onChange={(event) => setProfile({...profile, allergenNotice: event.target.value})}
              rows={3}
              maxLength={600}
            />
            <small className="muted">
              The kitchen-wide disclosure. Per-dish allergens are set on each dish; this is what a guest reads when a
              dish lists none.
            </small>
          </label>

          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      )}

      <AuditTrail branchId={branchId} />
    </>
  );
}

function describe(entry: AuditEntry): string {
  const detail = entry.detail ?? {};
  const name = typeof detail.name === 'string' ? detail.name : null;
  const email = typeof detail.email === 'string' ? detail.email : null;
  const amount = typeof detail.amountMinor === 'number' ? detail.amountMinor : null;
  const parts = [name ?? email ?? null, amount !== null ? `${(amount / 100).toFixed(2)} BWP` : null].filter(Boolean);
  return parts.join(' · ');
}

function AuditTrail({branchId}: {branchId: string}) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setEntries(null);
    setFailed(false);
    getDocs(
      query(
        collection(firebase().db, 'auditLogs'),
        where('branchId', '==', branchId),
        orderBy('at', 'desc'),
        limit(AUDIT_PAGE),
      ),
    )
      .then((snapshot) => {
        if (!live) return;
        setEntries(
          snapshot.docs.map((document) => {
            const data = document.data();
            return {
              id: document.id,
              action: String(data.action ?? 'unknown'),
              actorId: String(data.actorId ?? ''),
              actorType: String(data.actorType ?? ''),
              atMs: data.at?.toMillis?.() ?? 0,
              targetPath: String(data.targetPath ?? ''),
              detail: (data.detail as Record<string, unknown>) ?? {},
            };
          }),
        );
      })
      .catch(() => {
        if (!live) return;
        setFailed(true);
        setEntries([]);
      });
    return () => {
      live = false;
    };
  }, [branchId]);

  return (
    <>
      <div className="content-heading compact">
        <div>
          <p className="sectionlabel">Accountability</p>
          <h2>
            <ScrollText size={19} aria-hidden /> Audit trail
          </h2>
        </div>
      </div>

      {failed && (
        <Notice tone="warn">
          Could not read the audit trail. If this location was created recently its index may still be building.
        </Notice>
      )}

      {!entries && !failed && <CardListSkeleton count={5} lines={1} label="Loading the audit trail" />}
      {entries?.length === 0 && !failed && <Notice>Nothing has been recorded for this location yet.</Notice>}

      <section className="audit-list">
        {entries?.map((entry) => (
          <div key={entry.id} className="audit-row">
            <code>{entry.action}</code>
            <span className="small muted">
              {entry.atMs ? new Date(entry.atMs).toLocaleString('en-GB') : 'time unknown'} · {entry.actorType}{' '}
              {entry.actorId.slice(0, 8)}
              {describe(entry) && ` · ${describe(entry)}`}
            </span>
          </div>
        ))}
      </section>

      <p className="small muted">
        The {AUDIT_PAGE} most recent entries. The trail is append-only and written by the server, so nothing on this
        screen — and nobody signed in to it — can alter or remove a line.
      </p>
    </>
  );
}

export default function AdminSettingsPage() {
  return (
    <OperationsShell area="admin" title="Settings" subtitle="Location profile and the record of who changed what.">
      <div className="stack">
        <StaffGuard requireAdmin>{() => <Settings />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
