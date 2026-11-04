'use client';
/** Category browsing, the guest's entry point after a successful QR scan. */
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {fetchCategories, fetchPublishedItems, type MenuCategory, type MenuItem} from '@/lib/menu-data';
import {Notice, Photo, Spinner} from '@/components/ui';
import GuestChrome from '@/components/GuestChrome';
import MenuGuidance from '@/components/MenuGuidance';

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
    <GuestChrome title="What are you craving?" subtitle="Bold flavours, open-flame cooking and favourites from around the world.">
      {error && <Notice tone="error">{error}</Notice>}
      {!categories && !error && <Spinner label="Loading the menu" />}

      {categories && categories.length === 0 && (
        <Notice tone="warn">
          No menu categories have been published yet. The approved Bukhara menu and photography are still being loaded.
        </Notice>
      )}

      {categories && categories.length > 0 && (
        <>
          <div className="menu-facts" aria-label="Menu information">
            <span>Prices in BWP</span>
            <span>Freshly prepared</span>
            <span>Availability may change</span>
          </div>
          <MenuGuidance />
          <div className="content-heading">
            <div><p className="sectionlabel">Explore</p><h2>Choose a course</h2></div>
            <span>{categories.length} categories</span>
          </div>
          <section className="menu-category-grid">
            {categories.map((category) => (
              <Link key={category.id} href={`/menu/category/${category.id}`} className="category-tile">
                <Photo src={category.coverImagePath} alt="" />
                <div className="category-copy">
                  <h2>{category.name}</h2>
                  <p>
                    {countFor(category.id)} {countFor(category.id) === 1 ? 'dish' : 'dishes'}
                  </p>
                </div>
              </Link>
            ))}
          </section>
        </>
      )}
    </GuestChrome>
  );
}
