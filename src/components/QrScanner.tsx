'use client';
/**
 * In-app camera scanner for table QR codes.
 *
 * A guest whose session has expired, or who opened the app from somewhere other
 * than their table's code, has no way back to the menu: the capability that
 * authorizes ordering only comes from a /t/<token> link. This gives them a
 * camera instead of a dead end.
 *
 * The decoded value is deliberately NOT used as a URL to navigate to. Anyone
 * can print a QR code, so treating its contents as a destination would make
 * this an open redirect: a sticker on the table could send guests to a
 * look-alike site that harvests their order. Only the token is extracted, and
 * navigation is always to this origin's own /t/<token> route.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {Camera, CameraOff, Keyboard} from 'lucide-react';
import {Notice} from './ui';

/**
 * Pulls the table token out of a scanned value, accepting either a full table
 * URL or a bare token. The character class and length mirror the `opaqueToken`
 * contract the callable validates against, so an obviously malformed code is
 * rejected here rather than costing a round trip.
 */
export function extractTableToken(scanned: string): string | null {
  const value = scanned.trim();
  const fromUrl = /\/t\/([A-Za-z0-9_-]{16,256})(?:[/?#]|$)/.exec(value);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9_-]{16,256}$/.test(value) ? value : null;
}

type Phase = 'idle' | 'starting' | 'scanning' | 'denied' | 'unsupported' | 'found';

export default function QrScanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [manualValue, setManualValue] = useState('');

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // The camera must be released when the guest leaves this screen, or the
  // indicator light stays on and the device keeps the sensor powered.
  useEffect(() => stop, [stop]);

  const go = useCallback(
    (token: string) => {
      setPhase('found');
      stop();
      router.push(`/t/${token}`);
    },
    [router, stop],
  );

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('unsupported');
      return;
    }
    setPhase('starting');
    try {
      // The rear camera is the one pointing at the table card.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: 'environment'}},
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      await video.play();
      setPhase('scanning');

      // jsQR is only loaded once scanning actually starts: it is a sizeable
      // decoder and most visits never open the camera.
      const {default: jsQR} = await import('jsqr');

      const tick = () => {
        frameRef.current = requestAnimationFrame(tick);
        const canvas = canvasRef.current;
        if (!canvas || !video.videoWidth) return;
        const context = canvas.getContext('2d', {willReadFrequently: true});
        if (!context) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(frame.data, frame.width, frame.height, {inversionAttempts: 'dontInvert'});
        if (!result) return;
        const token = extractTableToken(result.data);
        if (!token) {
          setError('That code is not a Bukhara table code. Please scan the code on your table.');
          return;
        }
        go(token);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (failure) {
      stop();
      const name = (failure as {name?: string}).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPhase('denied');
        return;
      }
      setPhase('idle');
      setError('We could not open the camera. You can type your table code instead.');
    }
  }, [go, stop]);

  const submitManual = (event: React.FormEvent) => {
    event.preventDefault();
    const token = extractTableToken(manualValue);
    if (!token) {
      setError('That does not look like a table code. Check the code printed on your table.');
      return;
    }
    go(token);
  };

  return (
    <div className="stack">
      <div className="scanner-frame">
        {/* Kept mounted so the ref exists before play() is called. */}
        <video ref={videoRef} playsInline muted aria-label="Camera preview" />
        <canvas ref={canvasRef} hidden />
        {phase !== 'scanning' && (
          <div className="scanner-placeholder">
            {phase === 'starting' ? <span>Opening the camera…</span> : <Camera size={40} strokeWidth={1.2} aria-hidden />}
          </div>
        )}
        {phase === 'scanning' && <div className="scanner-reticle" aria-hidden />}
      </div>

      {phase === 'scanning' && (
        <p className="small muted" role="status">
          Point your camera at the QR code on your table.
        </p>
      )}

      {error && <Notice tone="warn">{error}</Notice>}

      {phase === 'denied' && (
        <Notice tone="warn">
          Camera access was blocked. Allow the camera in your browser settings, or type your table code below.
        </Notice>
      )}

      {phase === 'unsupported' && (
        <Notice tone="warn">
          This browser cannot open the camera. Please type the code printed on your table instead.
        </Notice>
      )}

      <div className="scanner-actions">
        {phase === 'scanning' ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              stop();
              setPhase('idle');
            }}
          >
            <CameraOff size={17} /> Stop camera
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => void start()} disabled={phase === 'starting' || phase === 'found'}>
            <Camera size={17} /> {phase === 'idle' ? 'Scan my table code' : 'Try the camera again'}
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => setManual((open) => !open)}>
          <Keyboard size={17} /> Enter code
        </button>
      </div>

      {manual && (
        <form className="card scanner-manual" onSubmit={submitManual}>
          <label htmlFor="table-code">Table code</label>
          <p className="small muted">
            The code printed under the QR square on your table, or the whole link it opens.
          </p>
          <input
            id="table-code"
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
            placeholder="Paste your table link or code"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn" disabled={manualValue.trim().length === 0}>
            Open my table
          </button>
        </form>
      )}
    </div>
  );
}
