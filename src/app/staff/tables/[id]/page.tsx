import TableDetail from './TableDetail';

export default async function StaffTablePage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <TableDetail tableId={id} />;
}
