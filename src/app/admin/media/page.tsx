'use client';
/**
 * Media library.
 *
 * Its real job is telling an administrator which dishes a guest sees as a grey
 * placeholder, because that is the part nobody notices from the inside.
 *
 * Uploading is deliberately not done from the browser: Cloud Storage denies
 * every client write, and photographs go through `npm run seed:images`, which
 * resizes and compresses before upload. A phone-sized original served straight
 * to a phone is the slowest menu there is. This screen attaches an already
 * uploaded photograph to a dish.
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {collection, getDocs, orderBy, query} from 'firebase/firestore';
import {ImageOff, Link2} from 'lucide-react';
import {firebase} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import {api, ApiError} from '@/lib/api';
import type {MenuOptionInput} from '@/lib/contracts';
import {BackLink, CardListSkeleton, Notice, Photo} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';
import ConfirmDialog from '@/components/ConfirmDialog';

type Item = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceMinor: number;
  available: boolean;
  published: boolean;
  sortOrder: number;
  allergens: string[];
  options: MenuOptionInput[];
  primaryImagePath: string | null;
};

type Filter = 'missing' | 'has' | 'all';

function Media() {
  const branchId = useBranchId();
  const [items, setItems] = useState<Item[] | null>(null);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>('missing');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    try {
      const {db} = firebase();
      const [itemSnapshot, categorySnapshot] = await Promise.all([
        getDocs(query(collection(db, `${branchPath(branchId)}/menuItems`), orderBy('sortOrder'))),
        getDocs(collection(db, `${branchPath(branchId)}/categories`)),
      ]);

      const names: Record<string, string> = {};
      categorySnapshot.forEach((document) => {
        names[document.id] = String(document.data().name ?? document.id);
      });
      setCategories(names);

      setItems(
        itemSnapshot.docs.map((document) => {
          const data = document.data();
          return {
            id: document.id,
            categoryId: String(data.categoryId ?? ''),
            name: String(data.name ?? document.id),
            description: String(data.description ?? ''),
            priceMinor: Number(data.priceMinor ?? 0),
            available: data.available === true,
            published: data.published === true,
            sortOrder: Number(data.sortOrder ?? 0),
            allergens: Array.isArray(data.allergens) ? (data.allergens as string[]) : [],
            options: Array.isArray(data.options) ? (data.options as MenuOptionInput[]) : [],
            primaryImagePath: (data.primaryImagePath as string | null) || null,
          };
        }),
      );
    } catch {
      setError('Could not load the menu photography.');
      setItems([]);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const coverage = useMemo(() => {
    const rows = items ?? [];
    const withPhoto = rows.filter((row) => row.primaryImagePath).length;
    const published = rows.filter((row) => row.published);
    return {
      total: rows.length,
      withPhoto,
      missing: rows.length - withPhoto,
      publishedMissing: published.filter((row) => !row.primaryImagePath).length,
      percent: rows.length ? Math.round((withPhoto / rows.length) * 100) : 0,
    };
  }, [items]);

  const shown = useMemo(() => {
    const rows = items ?? [];
    if (filter === 'missing') return rows.filter((row) => !row.primaryImagePath);
    if (filter === 'has') return rows.filter((row) => row.primaryImagePath);
    return rows;
  }, [items, filter]);

  const savePhoto = async (item: Item, path: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.saveMenuItem({
        branchId,
        itemId: item.id,
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        priceMinor: item.priceMinor,
        available: item.available,
        published: item.published,
        sortOrder: item.sortOrder,
        allergens: item.allergens,
        options: item.options,
        primaryImagePath: path,
      });
      setEditing(null);
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

      {!items && <CardListSkeleton count={4} lines={1} label="Loading photography" />}

      {items && (
        <>
          <section className="admin-statbar">
            <div className="card"><span>Dishes with a photo</span><strong>{coverage.withPhoto} / {coverage.total}</strong></div>
            <div className="card"><span>Coverage</span><strong>{coverage.percent}%</strong></div>
            <div className="card"><span>On the menu without one</span><strong>{coverage.publishedMissing}</strong></div>
          </section>

          {coverage.publishedMissing > 0 && (
            <Notice tone="warn">
              {coverage.publishedMissing === 1
                ? 'One published dish'
                : `${coverage.publishedMissing} published dishes`}{' '}
              show a grey placeholder to guests right now.
            </Notice>
          )}

          <Notice>
            Photographs are uploaded with <code>npm run seed:images</code>, which resizes and compresses each one
            before it reaches the bucket. That step is why the menu loads quickly on a phone, so uploading from here
            is deliberately not offered; paste the public URL the script prints.
          </Notice>

          <div className="range-tabs" role="group" aria-label="Which dishes to show">
            {([
              ['missing', `Missing (${coverage.missing})`],
              ['has', `With a photo (${coverage.withPhoto})`],
              ['all', `All (${coverage.total})`],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn btn-ghost small${filter === id ? ' active' : ''}`}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {shown.length === 0 && (
            <Notice tone="ok">
              {filter === 'missing' ? 'Every dish has a photograph.' : 'Nothing to show for this filter.'}
            </Notice>
          )}

          <section className="media-grid">
            {shown.map((item) => (
              <article key={item.id} className="card media-card">
                {item.primaryImagePath ? (
                  <Photo src={item.primaryImagePath} alt="" />
                ) : (
                  <div className="photo" aria-hidden>
                    <ImageOff size={22} />
                  </div>
                )}
                <div className="media-card-body">
                  <strong>{item.name}</strong>
                  <p className="small muted">
                    {categories[item.categoryId] ?? item.categoryId}
                    {!item.published && ' · hidden'}
                  </p>
                  <button type="button" className="btn btn-ghost small" onClick={() => setEditing(item)}>
                    <Link2 size={15} aria-hidden /> {item.primaryImagePath ? 'Change photo' : 'Attach a photo'}
                  </button>
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      <PhotoDialog item={editing} busy={busy} onCancel={() => setEditing(null)} onSave={savePhoto} />
    </>
  );
}

function PhotoDialog({
  item,
  busy,
  onCancel,
  onSave,
}: {
  item: Item | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (item: Item, path: string | null) => void;
}) {
  const [path, setPath] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (item && loadedFor !== item.id) {
    setLoadedFor(item.id);
    setPath(item.primaryImagePath ?? '');
  }

  return (
    <ConfirmDialog
      open={item !== null}
      title={item ? `Photograph for ${item.name}` : 'Photograph'}
      body={
        <div className="dialog-form">
          <label>
            <span>Public image URL</span>
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="https://storage.googleapis.com/…/menu/dish.jpg"
              maxLength={500}
            />
            <small className="muted">
              Clear the field to remove the photograph and go back to the placeholder.
            </small>
          </label>
          {path.trim() !== '' && !/^https:\/\//.test(path.trim()) && (
            <p className="dialog-problem" role="alert">
              Use a full https:// address, as printed by the upload script.
            </p>
          )}
        </div>
      }
      confirmLabel="Save"
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        const value = path.trim();
        if (value !== '' && !/^https:\/\//.test(value)) return;
        if (item) onSave(item, value === '' ? null : value);
      }}
    />
  );
}

export default function AdminMediaPage() {
  return (
    <OperationsShell area="admin" title="Media library" subtitle="Which dishes a guest sees a photograph of, and which they do not.">
      <div className="stack">
        <StaffGuard requireAdmin>{() => <Media />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
