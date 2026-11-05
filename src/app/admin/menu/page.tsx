'use client';
/**
 * Menu and pricing.
 *
 * This replaces the CSV import scripts for day-to-day work: a price change
 * during service should not require a laptop and a shell. The scripts remain
 * the right tool for a bulk reload of the whole menu.
 *
 * Editing a dish never alters an order already placed. Every order snapshots
 * the name, price and choices it was taken at, so a price put up at seven
 * o'clock does not rewrite a bill from six.
 */
import {useCallback, useEffect, useState} from 'react';
import {collection, getDocs, orderBy, query, where} from 'firebase/firestore';
import {CircleOff, EyeOff, Plus, Trash2} from 'lucide-react';
import {firebase} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import {api, ApiError} from '@/lib/api';
import {inputToMinor, minorToInput, slugify} from '@/lib/admin-format';
import {formatBwp} from '@/lib/order-domain';
import type {MenuOptionInput} from '@/lib/contracts';
import {BackLink, CardListSkeleton, Notice} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';
import ConfirmDialog from '@/components/ConfirmDialog';

type Category = {id: string; name: string; sortOrder: number; published: boolean; coverImagePath: string | null};

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

const blankItem = (categoryId: string, sortOrder: number): Item => ({
  id: '',
  categoryId,
  name: '',
  description: '',
  priceMinor: 0,
  available: true,
  published: true,
  sortOrder,
  allergens: [],
  options: [],
  primaryImagePath: null,
});

function Menu() {
  const branchId = useBranchId();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      const {db} = firebase();
      const snapshot = await getDocs(query(collection(db, `${branchPath(branchId)}/categories`), orderBy('sortOrder')));
      const rows = snapshot.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          name: String(data.name ?? document.id),
          sortOrder: Number(data.sortOrder ?? 0),
          published: data.published !== false,
          coverImagePath: (data.coverImagePath as string | null) ?? null,
        };
      });
      setCategories(rows);
      setSelected((current) => (current && rows.some((row) => row.id === current) ? current : (rows[0]?.id ?? null)));
    } catch {
      setError('Could not load the menu sections.');
    }
  }, [branchId]);

  const loadItems = useCallback(async () => {
    if (!selected) {
      setItems([]);
      return;
    }
    setItems(null);
    try {
      const {db} = firebase();
      const snapshot = await getDocs(
        query(
          collection(db, `${branchPath(branchId)}/menuItems`),
          where('categoryId', '==', selected),
          orderBy('sortOrder'),
        ),
      );
      setItems(
        snapshot.docs.map((document) => {
          const data = document.data();
          return {
            id: document.id,
            categoryId: String(data.categoryId ?? selected),
            name: String(data.name ?? document.id),
            description: String(data.description ?? ''),
            priceMinor: Number(data.priceMinor ?? 0),
            available: data.available === true,
            published: data.published === true,
            sortOrder: Number(data.sortOrder ?? 0),
            allergens: Array.isArray(data.allergens) ? (data.allergens as string[]) : [],
            options: Array.isArray(data.options) ? (data.options as MenuOptionInput[]) : [],
            primaryImagePath: (data.primaryImagePath as string | null) ?? null,
          };
        }),
      );
    } catch {
      setError('Could not load the dishes in this section.');
      setItems([]);
    }
  }, [branchId, selected]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);
  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const saveItem = async (draft: Item) => {
    const priceMinor = draft.priceMinor;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.saveMenuItem({
        branchId,
        itemId: draft.id || slugify(draft.name, undefined),
        categoryId: draft.categoryId,
        name: draft.name.trim(),
        description: draft.description.trim(),
        priceMinor,
        available: draft.available,
        published: draft.published,
        sortOrder: draft.sortOrder,
        allergens: draft.allergens,
        options: draft.options,
        primaryImagePath: draft.primaryImagePath,
      });
      setDone(`Saved ${draft.name.trim()}.`);
      setEditing(null);
      await loadItems();
    } catch (failure) {
      setError((failure as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (item: Item) => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMenuItem({branchId, itemId: item.id});
      setDeleting(null);
      setDone(`Removed ${item.name}.`);
      await loadItems();
    } catch (failure) {
      setError((failure as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const saveCategory = async (draft: {id: string; name: string; sortOrder: number; published: boolean}) => {
    setBusy(true);
    setError(null);
    try {
      await api.saveMenuCategory({
        branchId,
        categoryId: draft.id || slugify(draft.name, undefined),
        name: draft.name.trim(),
        sortOrder: draft.sortOrder,
        published: draft.published,
        coverImagePath: null,
      });
      setEditingCategory(null);
      setDone(`Saved ${draft.name.trim()}.`);
      await loadCategories();
    } catch (failure) {
      setError((failure as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <ItemEditor
        item={editing}
        categories={categories ?? []}
        busy={busy}
        error={error}
        onCancel={() => setEditing(null)}
        onSave={saveItem}
      />
    );
  }

  return (
    <>
      <BackLink href="/admin">Administration</BackLink>
      {error && <Notice tone="error">{error}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}

      {!categories && <CardListSkeleton count={4} lines={1} label="Loading the menu" />}

      {categories && (
        <div className="menu-admin">
          <aside className="menu-admin-sections">
            <div className="between">
              <p className="sectionlabel">Sections</p>
              <button type="button" className="btn btn-ghost small" onClick={() => setEditingCategory('new')}>
                <Plus size={15} aria-hidden /> Add
              </button>
            </div>
            {categories.length === 0 && <p className="small muted">No sections yet. Add one to start the menu.</p>}
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`menu-admin-section${category.id === selected ? ' active' : ''}`}
                onClick={() => setSelected(category.id)}
              >
                <span>{category.name}</span>
                {!category.published && <small title="Hidden from guests"><EyeOff size={13} /></small>}
              </button>
            ))}
          </aside>

          <section className="menu-admin-items">
            {selected && (
              <div className="between">
                <p className="sectionlabel">
                  {categories.find((category) => category.id === selected)?.name ?? 'Dishes'}
                </p>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost small"
                    onClick={() => {
                      const category = categories.find((row) => row.id === selected);
                      if (category) setEditingCategory(category);
                    }}
                  >
                    Edit section
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() =>
                      setEditing(blankItem(selected, ((items ?? []).at(-1)?.sortOrder ?? 0) + 10))
                    }
                  >
                    <Plus size={15} aria-hidden /> Add dish
                  </button>
                </div>
              </div>
            )}

            {!items && <CardListSkeleton count={5} lines={1} label="Loading dishes" />}
            {items?.length === 0 && <Notice>No dishes in this section yet.</Notice>}

            {items?.map((item) => (
              <div key={item.id} className="card admin-table-row">
                <div>
                  <strong>
                    {item.name}
                    {!item.published && <span className="pill-off">Hidden</span>}
                    {item.published && !item.available && <span className="pill-off">Sold out</span>}
                  </strong>
                  <p className="small muted" style={{margin: '4px 0 0'}}>
                    {formatBwp(item.priceMinor)}
                    {item.options.length > 0 && ` · ${item.options.length} choices`}
                    {!item.primaryImagePath && ' · no photo'}
                  </p>
                </div>
                <div className="row-actions">
                  <button type="button" className="btn btn-ghost small" onClick={() => setEditing(item)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost small"
                    onClick={() => void saveItemAvailability(item)}
                    title={item.available ? 'Mark sold out' : 'Back on'}
                  >
                    <CircleOff size={15} aria-hidden /> {item.available ? 'Sold out' : 'Back on'}
                  </button>
                  <button type="button" className="btn btn-ghost small" onClick={() => setDeleting(item)}>
                    <Trash2 size={15} aria-hidden />
                    <span className="sr-only">Remove {item.name}</span>
                  </button>
                </div>
              </div>
            ))}
          </section>
        </div>
      )}

      <CategoryDialog
        value={editingCategory}
        busy={busy}
        nextSortOrder={((categories ?? []).at(-1)?.sortOrder ?? 0) + 10}
        onCancel={() => setEditingCategory(null)}
        onSave={saveCategory}
      />

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={deleting ? `Remove ${deleting.name}?` : 'Remove this dish?'}
        body={
          <>
            <p>It disappears from the guest menu straight away. Bills already taken are unaffected.</p>
            <p>If it is only off for tonight, mark it sold out instead — that keeps it on the menu.</p>
          </>
        }
        confirmLabel="Remove the dish"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void removeItem(deleting);
        }}
      />
    </>
  );

  /** Toggling availability is a save of the same document, with one field changed. */
  async function saveItemAvailability(item: Item) {
    await saveItem({...item, available: !item.available});
  }
}

function CategoryDialog({
  value,
  busy,
  nextSortOrder,
  onCancel,
  onSave,
}: {
  value: Category | 'new' | null;
  busy: boolean;
  nextSortOrder: number;
  onCancel: () => void;
  onSave: (draft: {id: string; name: string; sortOrder: number; published: boolean}) => void;
}) {
  const [draft, setDraft] = useState({id: '', name: '', sortOrder: 0, published: true});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = value === 'new' ? 'new' : (value?.id ?? null);

  if (value && loadedFor !== key) {
    setLoadedFor(key);
    setDraft(
      value === 'new'
        ? {id: '', name: '', sortOrder: nextSortOrder, published: true}
        : {id: value.id, name: value.name, sortOrder: value.sortOrder, published: value.published},
    );
  }

  return (
    <ConfirmDialog
      open={value !== null}
      title={value === 'new' ? 'Add a menu section' : 'Edit menu section'}
      body={
        <div className="dialog-form">
          <label>
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft({...draft, name: event.target.value})}
              maxLength={80}
            />
          </label>
          <label>
            <span>Position</span>
            <input
              type="number"
              value={draft.sortOrder}
              onChange={(event) => setDraft({...draft, sortOrder: Number(event.target.value) || 0})}
              min={0}
              max={9999}
            />
            <small className="muted">Lower numbers appear first on the guest menu.</small>
          </label>
          <label className="checkline">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(event) => setDraft({...draft, published: event.target.checked})}
            />
            <span>Show this section to guests</span>
          </label>
        </div>
      }
      confirmLabel="Save section"
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (draft.name.trim()) onSave(draft);
      }}
    />
  );
}

function ItemEditor({
  item,
  categories,
  busy,
  error,
  onCancel,
  onSave,
}: {
  item: Item;
  categories: Category[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (draft: Item) => void;
}) {
  const [draft, setDraft] = useState(item);
  const [priceText, setPriceText] = useState(minorToInput(item.priceMinor));
  const [allergenText, setAllergenText] = useState(item.allergens.join(', '));
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const priceMinor = inputToMinor(priceText);
    if (priceMinor === null || priceMinor < 0) {
      setProblem('Write the price as pula and thebe, for example 125.50.');
      return;
    }
    for (const option of draft.options) {
      if (!option.name.trim()) {
        setProblem('Every choice needs a name.');
        return;
      }
    }
    setProblem(null);
    onSave({
      ...draft,
      priceMinor,
      allergens: allergenText
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    });
  };

  const setOption = (index: number, patch: Partial<MenuOptionInput>) => {
    setDraft({
      ...draft,
      options: draft.options.map((option, i) => (i === index ? {...option, ...patch} : option)),
    });
  };

  return (
    <form className="card admin-form" onSubmit={submit}>
      <button type="button" className="btn btn-ghost small" onClick={onCancel}>
        ← Back to the menu
      </button>
      <h2>{item.id ? `Edit ${item.name}` : 'New dish'}</h2>

      {error && <Notice tone="error">{error}</Notice>}
      {problem && <Notice tone="error">{problem}</Notice>}

      <div className="field-row">
        <label>
          <span>Name</span>
          <input
            value={draft.name}
            onChange={(event) => setDraft({...draft, name: event.target.value})}
            required
            maxLength={120}
          />
        </label>
        <label>
          <span>Price (BWP)</span>
          <input
            value={priceText}
            onChange={(event) => setPriceText(event.target.value)}
            inputMode="decimal"
            required
          />
        </label>
      </div>

      <label>
        <span>Description</span>
        <textarea
          value={draft.description}
          onChange={(event) => setDraft({...draft, description: event.target.value})}
          rows={3}
          maxLength={600}
        />
      </label>

      <div className="field-row">
        <label>
          <span>Section</span>
          <select
            value={draft.categoryId}
            onChange={(event) => setDraft({...draft, categoryId: event.target.value})}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Position</span>
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(event) => setDraft({...draft, sortOrder: Number(event.target.value) || 0})}
            min={0}
            max={9999}
          />
        </label>
      </div>

      <label>
        <span>Allergens</span>
        <input
          value={allergenText}
          onChange={(event) => setAllergenText(event.target.value)}
          placeholder="nuts, dairy, gluten"
        />
        <small className="muted">
          Separated by commas. Leaving this empty is not a statement that the dish is free of anything — the kitchen
          disclosure on the guest menu still applies.
        </small>
      </label>

      <label>
        <span>Photo path</span>
        <input
          value={draft.primaryImagePath ?? ''}
          onChange={(event) => setDraft({...draft, primaryImagePath: event.target.value.trim() || null})}
          placeholder="https://storage.googleapis.com/…/menu/dish.jpg"
        />
      </label>

      <div className="field-row">
        <label className="checkline">
          <input
            type="checkbox"
            checked={draft.published}
            onChange={(event) => setDraft({...draft, published: event.target.checked})}
          />
          <span>On the menu</span>
        </label>
        <label className="checkline">
          <input
            type="checkbox"
            checked={draft.available}
            onChange={(event) => setDraft({...draft, available: event.target.checked})}
          />
          <span>Available to order tonight</span>
        </label>
      </div>

      <fieldset className="option-editor">
        <legend>Choices</legend>
        <p className="small muted">
          Extras and variations a guest can pick. A price difference may be negative for a smaller portion.
        </p>
        {draft.options.map((option, index) => (
          <div key={option.id} className="option-row">
            <input
              value={option.name}
              onChange={(event) => setOption(index, {name: event.target.value})}
              placeholder="Extra cheese"
              aria-label="Choice name"
              maxLength={80}
            />
            <input
              defaultValue={minorToInput(option.priceDeltaMinor)}
              onChange={(event) => {
                const minor = inputToMinor(event.target.value);
                if (minor !== null) setOption(index, {priceDeltaMinor: minor});
              }}
              inputMode="decimal"
              aria-label="Price difference"
            />
            <button
              type="button"
              className="btn btn-ghost small"
              onClick={() => setDraft({...draft, options: draft.options.filter((_, i) => i !== index)})}
            >
              <Trash2 size={15} aria-hidden />
              <span className="sr-only">Remove this choice</span>
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost small"
          onClick={() =>
            setDraft({
              ...draft,
              options: [
                ...draft.options,
                {id: `opt-${Date.now().toString(36)}`, name: '', priceDeltaMinor: 0, available: true},
              ],
            })
          }
        >
          <Plus size={15} aria-hidden /> Add a choice
        </button>
      </fieldset>

      <div className="row-actions">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Saving…' : 'Save dish'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function AdminMenuPage() {
  return (
    <OperationsShell area="admin" title="Menu & pricing" subtitle="Publish dishes, set prices and take things off for the night.">
      <div className="stack">
        <StaffGuard requireAdmin>{() => <Menu />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
