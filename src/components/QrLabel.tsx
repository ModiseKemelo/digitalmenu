'use client';
/**
 * A printable table QR label.
 *
 * The raw token is returned by the server exactly once, so this renders it
 * immediately and offers printing. Firestore stores only the token's hash;
 * there is no way to show a code again later, which is why a damaged label is
 * replaced by issuing a new code rather than reprinting the old one.
 */
import {useEffect, useState} from 'react';
import QRCode from 'qrcode';

export default function QrLabel({label, tableId, payload}: {label: string; tableId: string; payload: string}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(payload, {errorCorrectionLevel: 'M', margin: 2, width: 600})
      .then((url) => {
        if (live) setDataUrl(url);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [payload]);

  return (
    <div className="qr-print">
      <div className="qr-card">
        <h2>{label}</h2>
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URL generated in the browser
          <img src={dataUrl} alt={`QR code for ${label}`} width={300} height={300} />
        ) : failed ? (
          <p className="small">Could not draw the code. Use the link below.</p>
        ) : (
          <p className="small muted">Drawing code…</p>
        )}
        <p className="qr-caption">
          Scan to view the menu and order
          <br />
          <small>{tableId}</small>
        </p>
      </div>

      <div className="qr-actions">
        <button type="button" className="btn" onClick={() => window.print()}>
          Print this label
        </button>
        <p className="small muted" style={{margin: '8px 0 0'}}>
          Printed once, this code cannot be shown again. If it is lost before printing, issue another.
        </p>
        <details style={{marginTop: 8}}>
          <summary className="small">Show the link instead</summary>
          <code style={{wordBreak: 'break-all', fontSize: 12}}>{payload}</code>
        </details>
      </div>
    </div>
  );
}
