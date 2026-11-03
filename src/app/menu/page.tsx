'use client';
/** Category browsing, the guest's entry point after a successful QR scan. */
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {fetchCategories, fetchPublishedItems, type MenuCategory, type MenuItem} from '@/lib/menu-data';
import {Notice, Photo, Spinner} from '@/components/ui';
import GuestChrome from '@/components/GuestChrome';

export default function MenuPage() {
  const [categories, setCategories] = useState<MenuCategory[] | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchCategories(), fetchPublishedItems()])
      .then(([loadedCategories, loadedItems]) => {
        setCategories(loadedCategories);
        setItems(loadedItems);
      })
      .catch(() => setError('The menu could not be loaded. Please check your connection or ask a member of staff.'));
  }, []);

  const countFor = (categoryId: string) => items.filter((item) => item.categoryId === categoryId).length;

  return (
    <GuestChrome title="Our menu" subtitle="Browse by course, then add dishes to your order.">
      {error && <Notice tone="error">{error}</Notice>}
      {!categories && !error && <Spinner label="Loading the menu" />}

      {categories && categories.length === 0 && (
        <Notice tone="warn">
          No menu categories have been published yet. The approved Bukhara menu and photography are still being loaded.
        </Notice>
      )}

      {categories && categories.length > 0 && (
        <section className="gridcards" style={{marginTop: 4}}>
          {categories.map((category) => (
            <Link key={category.id} href={`/menu/category/${category.id}`} className="card" style={{textDecoration: 'none'}}>
              <Photo src={category.coverImagePath} alt="" />
              <div style={{padding: 14}}>
                <h2 style={{margin: 0, fontSize: 19}}>{category.name}</h2>
                <p className="muted small" style={{margin: '6px 0 0'}}>
                  {countFor(category.id)} {countFor(category.id) === 1 ? 'dish' : 'dishes'}
                </p>
              </div>
            </Link>
          ))}
        </section>
      )}
    </GuestChrome>
  );
}
