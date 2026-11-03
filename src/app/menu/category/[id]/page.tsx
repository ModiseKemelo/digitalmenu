import CategoryItems from './CategoryItems';

export default async function CategoryPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <CategoryItems categoryId={id} />;
}
