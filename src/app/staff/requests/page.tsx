'use client';
/**
 * The service-call queue.
 *
 * Until this screen existed, a guest tapping "request the bill" or "call a
 * waiter" wrote a serviceRequests document that nothing ever read: the request
 * vanished and the guest waited for someone who was never told. This is the
 * display side of that flow.
 *
 * Requests arrive over a snapshot listener, like the order board, so a call
 * appears without a refresh. The oldest sits at the top, because the guest who
 * has waited longest is the one to serve next.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Bell, ReceiptText, ConciergeBell, Volume2, VolumeX, Check} from 'lucide-react';
import {collection, onSnapshot, query, where, orderBy, getDocs} from 'firebase/firestore';
import {firebase, RESTAURANT_ID} from '@/lib/firebase-client';
import type {ServiceRequestType} from '@/lib/contracts';
import {api, ApiError} from '@/lib/api';
import {Notice, Spinner} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';

type LiveRequest = {
  id: string;
  tableId: string;
  sessionId: string;
  type: ServiceRequestType;
  createdAtMs: number;
};

/** A short tone, synthesised so the app needs no audio asset. */
function useAlertTone() {
  const context = useRef<AudioContext | null>(null);
  return useCallback(() => {
    try {
      context.current ??= new AudioContext();
      const audio = context.current;
      if (audio.state === 'suspended') void audio.resume();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      // A two-tone chime, pitched apart from the order alert so a waiter can
      // tell a service call from a new order without looking.
      oscillator.frequency.setValueAtTime(660, audio.currentTime);
      oscillator.frequency.setValueAtTime(990, audio.currentTime + 0.16);
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.5);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.52);
    } catch {
      // Audio is a convenience; the list itself is the reliable signal.
    }
  }, []);
}

function waitedFor(createdAtMs: number, nowMs: number): string {
  if (!createdAtMs) return 'just now';
  const seconds = Math.max(0, Math.round((nowMs - createdAtMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const LABELS: Record<ServiceRequestType, {title: string; blurb: string; icon: typeof Bell}> = {
  bill: {title: 'Bill requested', blurb: 'Bring the bill to this table.', icon: ReceiptText},
  assistance: {title: 'Waiter called', blurb: 'A guest needs help at this table.', icon: ConciergeBell},
};

function Queue() {
  const [requests, setRequests] = useState<LiveRequest[] | null>(null);
  const [tables, setTables] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const knownIds = useRef<Set<string> | null>(null);
  const playTone = useAlertTone();

  // Table labels live on the table documents, not on the request, so they are
  // read once rather than denormalised into every request.
  useEffect(() => {
    const {db} = firebase();
    getDocs(collection(db, `restaurants/${RESTAURANT_ID}/tables`))
      .then((snapshot) => {
        const next: Record<string, string> = {};
        snapshot.forEach((document) => {
          next[document.id] = (document.data() as {label?: string}).label ?? document.id;
        });
        setTables(next);
      })
      .catch(() => {
        // The queue is still usable with raw table ids.
      });
  }, []);

  // Waiting times are rendered from a ticking clock rather than recomputed per
  // snapshot, so "waited 4 min" keeps counting while nothing changes.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const {db} = firebase();
    const live = query(
      collection(db, `restaurants/${RESTAURANT_ID}/serviceRequests`),
      where('status', '==', 'open'),
      orderBy('createdAt', 'asc'),
    );

    return onSnapshot(
      live,
      (snapshot) => {
        const next = snapshot.docs.map((document) => {
          const data = document.data() as {
            tableId: string;
            sessionId: string;
            type: ServiceRequestType;
            createdAt: {toMillis(): number} | null;
          };
          return {
            id: document.id,
            tableId: data.tableId,
            sessionId: data.sessionId,
            type: data.type,
            createdAtMs: data.createdAt?.toMillis() ?? 0,
          };
        });

        // Only ring for requests that are new to this screen, so a resolve or a
        // reconnect does not set the chime off again.
        const ids = new Set(next.map((request) => request.id));
        if (knownIds.current) {
          const arrived = next.some((request) => !knownIds.current?.has(request.id));
          if (arrived && soundOn) playTone();
        }
        knownIds.current = ids;

        setRequests(next);
        setError(null);
      },
      () => setError('The live service feed stopped. Reload the page to reconnect.'),
    );
  }, [playTone, soundOn]);

  const resolve = async (request: LiveRequest) => {
    setBusyId(request.id);
    setError(null);
    try {
      await api.resolveServiceRequest({requestId: request.id});
      // The listener removes the row; no local mutation needed.
    } catch (failure) {
      const apiError = failure as ApiError;
      setError(
        apiError.code === 'already-resolved'
          ? 'Another member of staff has already handled that request.'
          : 'We could not mark that request done. Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const oldestWaitMs = useMemo(() => {
    const stamps = (requests ?? []).map((request) => request.createdAtMs).filter((stamp) => stamp > 0);
    return stamps.length > 0 ? nowMs - Math.min(...stamps) : 0;
  }, [requests, nowMs]);

  return (
    <>
      <section className="admin-statbar">
        <div className="card"><span>Open calls</span><strong>{requests?.length ?? '—'}</strong></div>
        <div className="card"><span>Longest wait</span><strong>{oldestWaitMs > 0 ? waitedFor(nowMs - oldestWaitMs, nowMs) : '—'}</strong></div>
        <div className="card">
          <span>Audible alert</span>
          <button type="button" className="btn btn-ghost small" onClick={() => setSoundOn((on) => !on)}>
            {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />} {soundOn ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      {!soundOn && (
        <Notice>
          Turn the audible alert on to be chimed when a guest calls. Browsers only permit sound after a tap, so this
          cannot be enabled for you automatically.
        </Notice>
      )}

      {!requests && !error && <Spinner label="Loading service calls" />}

      {requests?.length === 0 && (
        <Notice tone="ok">No one is waiting. Guest calls will appear here the moment they are made.</Notice>
      )}

      <div className="request-queue">
        {requests?.map((request) => {
          const {title, blurb, icon: Icon} = LABELS[request.type] ?? LABELS.assistance;
          return (
            <article key={request.id} className={`card request-row${request.type === 'bill' ? ' is-bill' : ''}`}>
              <span className="feature-icongold"><Icon size={20} /></span>
              <div className="request-copy">
                <h2>{tables[request.tableId] ?? request.tableId}</h2>
                <p><strong>{title}</strong> &middot; {blurb}</p>
                <p className="small muted">Waiting {waitedFor(request.createdAtMs, nowMs)}</p>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => void resolve(request)}
                disabled={busyId === request.id}
              >
                <Check size={17} /> {busyId === request.id ? 'Saving…' : 'Mark done'}
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}

export default function ServiceRequestsPage() {
  return (
    <OperationsShell area="staff" title="Service calls" subtitle="Guests asking for the bill or for help, oldest first.">
      <div className="stack">
        <StaffGuard>{() => <Queue />}</StaffGuard>
      </div>
    </OperationsShell>
  );
}
