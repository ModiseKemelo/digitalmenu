/**
 * Cloud Functions entry point.
 *
 * Every privileged action lives behind a callable that validates its input with
 * Zod, re-checks authorization server-side, prices from Firestore and writes in
 * a transaction. Firestore rules deny all client writes, so these functions are
 * the only write path (docs/04-SECURITY-AND-DATA.md, docs/09-API-CONTRACTS.md).
 */
import {onCall} from 'firebase-functions/v2/https';
import {callableOptions} from './runtime';

export const healthcheck = onCall(callableOptions, async () => ({status: 'ok', service: 'bukhara-functions'}));

export {resolveTableQr, submitGuestOrder, getGuestSessionView, createServiceRequest} from './guest';
export {submitWaiterOrder, updateOrderStatus, recordManualPayment, reverseManualPayment, closeDiningSession} from './staff';
export {rotateTableQrToken} from './admin';
