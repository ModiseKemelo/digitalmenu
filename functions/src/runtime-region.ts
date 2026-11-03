/**
 * Deployment region, in a module with no Firebase Admin import so the browser
 * and the test harness can read it without initialising the Admin SDK.
 *
 * Johannesburg is the closest Google region to Gaborone; us-central1 adds
 * roughly 200ms to every order and status change. This must match
 * NEXT_PUBLIC_FUNCTIONS_REGION on the client.
 */
export const REGION = process.env.FUNCTIONS_REGION ?? 'africa-south1';
