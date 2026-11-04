'use client';
/**
 * Typed wrappers over the callable functions. The client never computes or
 * sends money; it sends ids, quantities and an idempotency key.
 */
import {httpsCallable, type HttpsCallableResult} from 'firebase/functions';
import {firebase} from './firebase-client';
import type {
  ResolveTableQrResult,
  SubmitGuestOrderInput,
  SubmitOrderResult,
  SubmitWaiterOrderInput,
  UpdateOrderStatusInput,
  UpdateOrderStatusResult,
  RecordManualPaymentInput,
  RecordManualPaymentResult,
  ReverseManualPaymentInput,
  ReverseManualPaymentResult,
  CloseDiningSessionInput,
  CloseDiningSessionResult,
  CreateServiceRequestInput,
  CreateServiceRequestResult,
  ResolveServiceRequestInput,
  ResolveServiceRequestResult,
  RotateTableQrTokenInput,
  RotateTableQrTokenResult,
  GuestSessionView,
} from './contracts';

/** A structured error from a callable, carrying the server's error code. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpCode: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type FirebaseCallableError = {code?: string; message?: string; details?: {code?: string}};

function call<TInput, TResult>(name: string) {
  return async (input: TInput): Promise<TResult> => {
    const callable = httpsCallable<TInput, TResult>(firebase().functions, name);
    try {
      const response: HttpsCallableResult<TResult> = await callable(input);
      return response.data;
    } catch (error) {
      const failure = error as FirebaseCallableError;
      throw new ApiError(
        failure.message ?? 'The request failed',
        failure.details?.code ?? 'unknown',
        failure.code ?? 'internal',
      );
    }
  };
}

export const api = {
  resolveTableQr: call<{token: string}, ResolveTableQrResult>('resolveTableQr'),
  submitGuestOrder: call<SubmitGuestOrderInput, SubmitOrderResult>('submitGuestOrder'),
  getGuestSessionView: call<{capability: string}, GuestSessionView>('getGuestSessionView'),
  createServiceRequest: call<CreateServiceRequestInput, CreateServiceRequestResult>('createServiceRequest'),
  resolveServiceRequest: call<ResolveServiceRequestInput, ResolveServiceRequestResult>('resolveServiceRequest'),
  submitWaiterOrder: call<SubmitWaiterOrderInput, SubmitOrderResult>('submitWaiterOrder'),
  updateOrderStatus: call<UpdateOrderStatusInput, UpdateOrderStatusResult>('updateOrderStatus'),
  recordManualPayment: call<RecordManualPaymentInput, RecordManualPaymentResult>('recordManualPayment'),
  reverseManualPayment: call<ReverseManualPaymentInput, ReverseManualPaymentResult>('reverseManualPayment'),
  closeDiningSession: call<CloseDiningSessionInput, CloseDiningSessionResult>('closeDiningSession'),
  rotateTableQrToken: call<RotateTableQrTokenInput, RotateTableQrTokenResult>('rotateTableQrToken'),
};

/**
 * A stable key for one submission attempt. Generated once when the guest taps
 * "place order" and reused for every retry, so a flaky network produces one
 * order, not several (T05, T13).
 */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
