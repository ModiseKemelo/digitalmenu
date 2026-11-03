import Link from 'next/link';

export default function Brand({compact = false, inverse = false}: {compact?: boolean; inverse?: boolean}) {
  return (
    <Link href="/" className={`brandlockup${inverse ? ' brandlockup-inverse' : ''}`} aria-label="Bukhara Restaurant home">
      <span className="brand-monogram" aria-hidden>B</span>
      {!compact && (
        <span className="brand-words">
          <strong>Bukhara</strong>
          <small>Restaurant · Gaborone</small>
        </span>
      )}
    </Link>
  );
}
