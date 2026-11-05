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
import {firebase} from '@/lib/firebase-client';
import {useBranchId, branchPath} from '@/lib/branch';
import type {ServiceRequestType} from '@/lib/contracts';
import {api, ApiError} from '@/lib/api';
import {CardListSkeleton, Notice} from '@/components/ui';
import StaffGuard from '@/components/StaffGuard';
import OperationsShell from '@/components/OperationsShell';

type LiveRequest = {
  id: string;
  tableId: string;
  sessionId: string;
  type: ServiceRequestType;
  createdAtMs: number;
};

/**
 * An alert meant to be hard to ignore.
 *
 * A single soft chime was easy to miss across a noisy dining room, and a guest
 * who has pressed the bell has no other way to reach anyone. So this is a
 * four-note rising pattern on a square wave - harmonically rich, so it cuts
 * through chatter far better than a sine tone at the same volume - and it
 * REPEATS on a timer for as long as anyone is still waiting, rather than
 * firing once on arrival. Escalates after two minutes.
 *
 * It stays behind an explicit on/off control. A sound designed to be
 * unignorable must also be switchable off by the person it is aimed at.
 */
function useUrgentAlert() {
  const context = useRef<AudioContext | null>(null);

  return useCallback((urgent: boolean) => {
    try {
      context.current ??= new AudioContext();
      const audio = context.current;
      if (audio.state === 'suspended') void audio.resume();

      // Rising thirds: a shape heard as a summons rather than a notification.
      const notes = urgent ? [740, 988, 740, 988, 1175] : [659, 880, 659, 880];
      const noteLength = 0.17;
      const peak = urgent ? 0.34 : 0.26;

      notes.forEach((frequency, index) => {
        const start = audio.currentTime + index * noteLength;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        // Square carries across a busy room; the lowpass takes the harshest
        // edge off so it is attention-getting rather than painful.
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(frequency, start);
        const filter = audio.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3200, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + noteLength * 0.92);
        oscillator.connect(filter).connect(gain).connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + noteLength);
      });
    } catch {
      // Audio is a convenience; the list and the pulsing banner are the
      // reliable signals.
    }

    // Phones live in aprons. Vibration reaches a waiter the speakers cannot.
    try {
      navigator.vibrate?.(urgent ? [260, 110, 260, 110, 420] : [200, 100, 200]);
    } catch {
      // Not supported everywhere, and never essential.
    }
  }, []);
}

/** How often the alert repeats while calls are still open. */
const REPEAT_MS = 20_000;
/** A call waiting longer than this escalates the alert. */
const URGENT_AFTER_MS = 120_000;

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
  const branchId = useBranchId();
  const [requests, setRequests] = useState<LiveRequest[] | null>(null);
  const [tables, setTables] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const knownIds = useRef<Set<string> | null>(null);
  const playAlert = useUrgentAlert();
  /** Read inside the listener so toggling sound does not resubscribe it. */
  const soundOnRef = useRef(soundOn);
  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  // Table labels live on the table documents, not on the request, so they are
  // read once rather than denormalised into every request.
  useEffect(() => {
    const {db} = firebase();
    getDocs(collection(db, `${branchPath(branchId)}/tables`))
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
  }, [branchId]);

  // Waiting times are rendered from a ticking clock rather than recomputed per
  // snapshot, so "waited 4 min" keeps counting while nothing changes.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const {db} = firebase();
    const live = query(
      collection(db, `${branchPath(branchId)}/serviceRequests`),
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
          if (arrived && soundOnRef.current) playAlert(false);
        }
        knownIds.current = ids;

        setRequests(next);
        setError(null);
      },
      () => setError('The live service feed stopped. Reload the page to reconnect.'),
    );
  }, [playAlert, branchId]);

  // Re-alerts for as long as anybody is waiting. A call that nobody clears
  // keeps asking; silence would mean the guest is simply forgotten.
  const openCount = requests?.length ?? 0;
  const longestWaitMs = useMemo(() => {
    const stamps = (requests ?? []).map((request) => request.createdAtMs).filter((stamp) => stamp > 0);
    return stamps.length > 0 ? Date.now() - Math.min(...stamps) : 0;
  }, [requests]);
  const urgent = longestWaitMs >= URGENT_AFTER_MS;

  // Kept in a ref so escalating does not restart the repeat timer.
  const urgentRef = useRef(urgent);
  useEffect(() => {
    urgentRef.current = urgent;
  }, [urgent]);

  useEffect(() => {
    if (!soundOn || openCount === 0) return;
    const timer = setInterval(() => playAlert(urgentRef.current), REPEAT_MS);
    return () => clearInterval(timer);
  }, [soundOn, openCount, playAlert]);

  const resolve = async (request: LiveRequest) => {
    setBusyId(request.id);
    setError(null);
    try {
      await api.resolveServiceRequest({requestId: request.id, branchId});
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
        <div className={`card${openCount > 0 ? ' calls-urgent' : ''}`}><span>Open calls</span><strong>{requests?.length ?? '—'}</strong></div>
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
        <Notice tone={openCount > 0 ? 'warn' : 'info'}>
          <span className="calls-alertbar">
            <span>
              Turn the alert on to be called when a guest presses the bell. Browsers only permit sound after a tap, so
              it cannot be switched on for you.
            </span>
            <button type="button" className="btn small" onClick={() => {
              setSoundOn(true);
              playAlert(false);
            }}>
              Turn the alert on
            </button>
          </span>
        </Notice>
      )}

      {soundOn && openCount > 0 && (
        <Notice tone={urgent ? 'error' : 'warn'}>
          {urgent
            ? `Someone has been waiting over two minutes. The alert will keep sounding until the call is cleared.`
            : `The alert repeats every ${REPEAT_MS / 1000} seconds while anyone is waiting.`}
        </Notice>
      )}

      {!requests && !error && <CardListSkeleton count={2} lines={2} label="Loading service calls" />}

      {requests?.length === 0 && (
        <Notice tone="ok">No one is waiting. Guest calls will appear here the moment they are made.</Notice>
      )}

      <div className="request-queue">
        {requests?.map((request) => {
          const {title, blurb, icon: Icon} = LABELS[request.type] ?? LABELS.assistance;
          return (
            <article
              key={request.id}
              className={`card request-row${request.type === 'bill' ? ' is-bill' : ''}${
                nowMs - request.createdAtMs >= URGENT_AFTER_MS && request.createdAtMs > 0 ? ' waiting-long' : ''
              }`}
            >
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
