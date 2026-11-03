import TableLanding from './TableLanding';

/**
 * The QR landing route. The token in the URL is exchanged server-side for a
 * session-bound capability; it is never itself treated as proof of membership
 * in a dining party (docs/04-SECURITY-AND-DATA.md).
 */
export default async function TableMenuPage({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  return <TableLanding token={token} />;
}
