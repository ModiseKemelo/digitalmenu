'use client';
/**
 * Guest menu reads.
 *
 * Published menu data is a public read in the security rules, so the guest menu
 * comes straight from Firestore rather than through a function. Order and
 * payment data never does.
 */
import {collection, getDocs, query, where, orderBy, doc, getDoc} from 'firebase/firestore';
import {firebase, RESTAURANT_ID} from './firebase-client';

export type MenuOption = {id: string; name: string; priceDeltaMinor: number; available?: boolean};

export type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceMinor: number;
  available: boolean;
  primaryImagePath: string | null;
  allergens: string[];
  options: MenuOption[];
  sortOrder: number;
};

export type MenuCategory = {id: string; name: string; sortOrder: number; coverImagePath: string | null};

const restaurantPath = () => `restaurants/${RESTAURANT_ID}`;

export async function fetchCategories(): Promise<MenuCategory[]> {
  const {db} = firebase();
  const snapshot = await getDocs(
    query(collection(db, `${restaurantPath()}/categories`), where('published', '==', true), orderBy('sortOrder')),
  );
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      name: String(data.name ?? document.id),
      sortOrder: Number(data.sortOrder ?? 0),
      coverImagePath: (data.coverImagePath as string | null) ?? null,
    };
  });
}

function toMenuItem(id: string, data: Record<string, unknown>): MenuItem {
  return {
    id,
    categoryId: String(data.categoryId ?? ''),
    name: String(data.name ?? id),
    description: String(data.description ?? ''),
    priceMinor: Number(data.priceMinor ?? 0),
    available: data.available === true,
    primaryImagePath: (data.primaryImagePath as string | null) ?? null,
    allergens: Array.isArray(data.allergens) ? (data.allergens as string[]) : [],
    options: Array.isArray(data.options) ? (data.options as MenuOption[]) : [],
    sortOrder: Number(data.sortOrder ?? 0),
  };
}

export async function fetchPublishedItems(categoryId?: string): Promise<MenuItem[]> {
  const {db} = firebase();
  const base = collection(db, `${restaurantPath()}/menuItems`);
  const snapshot = await getDocs(
    categoryId
      ? query(base, where('published', '==', true), where('categoryId', '==', categoryId), orderBy('sortOrder'))
      : query(base, where('published', '==', true), orderBy('sortOrder')),
  );
  return snapshot.docs.map((document) => toMenuItem(document.id, document.data()));
}

export async function fetchItem(itemId: string): Promise<MenuItem | null> {
  const {db} = firebase();
  const snapshot = await getDoc(doc(db, `${restaurantPath()}/menuItems/${itemId}`));
  if (!snapshot.exists()) return null;
  const item = toMenuItem(snapshot.id, snapshot.data());
  return item;
}
