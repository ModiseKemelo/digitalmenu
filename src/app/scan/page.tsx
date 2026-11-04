import Link from 'next/link';
import Brand from '@/components/Brand';
import QrScanner from '@/components/QrScanner';

/**
 * The scanning screen. Reached from the home page and from the expired-session
 * notice, both of which were previously dead ends for a guest without a live
 * table capability.
 */
export const metadata = {title: 'Scan your table · Bukhara'};

export default function ScanPage() {
  return (
    <main className="guest-shell">
      <div className="guest-brandbar"><Brand /></div>
      <header className="guest-hero compact">
        <p className="eyebrow">Secure table access</p>
        <h1>Scan your table</h1>
        <p>Your table&rsquo;s QR code connects this phone to your dining session.</p>
      </header>
      <div className="guest-content">
        <QrScanner />
        <p className="small muted">
          Can&rsquo;t find a code? Ask a member of staff &mdash; they can open the table for you.
        </p>
        <p className="small muted"><Link href="/">Back to the start</Link></p>
      </div>
    </main>
  );
}
