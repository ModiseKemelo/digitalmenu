'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {Search} from 'lucide-react';
import {fetchPublishedItems, type MenuItem} from '@/lib/menu-data';
import {Money, Notice, Photo, Spinner, BackLink} from '@/components/ui';
import GuestChrome from '@/components/GuestChrome';

export default function CategoryItems({categoryId}: {categoryId: string}) {
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchPublishedItems(categoryId)
      .then(setItems)
      .catch(() => setError('These dishes could not be loaded. Please ask a member of staff.'));
  }, [categoryId]);

  const term = search.trim().toLowerCase();
  const visible = (items ?? []).filter(
    (item) => !term || item.name.toLowerCase().includes(term) || item.description.toLowerCase().includes(term),
  );

  return (
    <GuestChrome title="Dishes" subtitle="Tap a dish to see the detail and add it to your order.">
      <BackLink href="/menu">All categories</BackLink>
      {error && <Notice tone="error">{error}</Notice>}
      {!items && !error && <Spinner label="Loading dishes" />}

      {items && items.length > 0 && (
        <div className="searchwrap">
          <Search size={18} strokeWidth={2} aria-hidden />
          <label htmlFor="dish-search" className="sr-only">
            Search these dishes
          </label>
          <input
            id="dish-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or description"
          />
        </div>
      )}

      {items && items.length === 0 && <Notice tone="warn">No dishes are published in this category yet.</Notice>}
      {items && items.length > 0 && visible.length === 0 && <Notice>No dishes match “{search}”.</Notice>}

      <section className="gridcards">
        {visible.map((item) => (
          <article key={item.id} className="card">
            <Photo src={item.primaryImagePath} alt="" />
            <div style={{padding: 14}}>
              <div className="between">
                <h2 style={{margin: 0, fontSize: 18}}>{item.name}</h2>
                <Money minor={item.priceMinor} />
              </div>
              {item.description && (
                <p className="muted small" style={{margin: '8px 0 0'}}>
                  {item.description}
                </p>
              )}
              {!item.available && (
                <p className="small" style={{margin: '8px 0 0', color: 'var(--danger)'}}>
                  Unavailable today
                </p>
              )}
              <div style={{marginTop: 12}}>
                {item.available ? (
                  <Link href={`/menu/item/${item.id}`} className="btn">
                    View dish
                  </Link>
                ) : (
                  <button className="btn" disabled>
                    Unavailable
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </section>
    </GuestChrome>
  );
}
