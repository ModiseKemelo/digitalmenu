/**
 * Application default credentials derived from the local Firebase CLI login.
 *
 * This machine has no ADC and no gcloud, and a long-lived service-account key
 * is the thing we most want to avoid putting on disk. The Firebase CLI has
 * already stored a refresh token for the signed-in user, so the provisioning
 * scripts reuse it, written out in the same "authorized_user" shape that
 * `gcloud auth application-default login` produces.
 *
 * It has to be a file on disk: firebase-admin's Firestore client accepts only a
 * certificate credential or real application default credentials, and rejects a
 * hand-rolled Credential object. The file is written to `.local/`, which is
 * gitignored, with owner-only permissions. Revoke by deleting it and running
 * `firebase logout`.
 *
 * Local development only. In CI or on a server, set GOOGLE_APPLICATION_CREDENTIALS
 * to a real credential and this is never consulted.
 */
import {writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const DEFAULT_CLI_PATH = '/home/max/.local/firebase-cli/node_modules/firebase-tools';
const ADC_PATH = resolve(process.cwd(), '.local/adc.json');

type CliAuth = {
  getGlobalDefaultAccount: () => {user?: {email?: string}; tokens?: {refresh_token?: string}} | undefined;
};
type CliApi = {clientId: () => string; clientSecret: () => string};

/**
 * Points GOOGLE_APPLICATION_CREDENTIALS at a credential derived from the CLI
 * login, writing it first if needed. Returns the account email, or null when
 * the CLI is absent or nobody is signed in.
 */
export function applyCliCredentials(): string | null {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;

  let auth: CliAuth;
  let api: CliApi;
  try {
    // Resolved at run time: the CLI deliberately is not a dependency of this
    // project, because its bundled glob/lru-cache break the app's tree.
    /* eslint-disable @typescript-eslint/no-require-imports */
    auth = require(`${process.env.FIREBASE_TOOLS_PATH ?? DEFAULT_CLI_PATH}/lib/auth.js`) as CliAuth;
    api = require(`${process.env.FIREBASE_TOOLS_PATH ?? DEFAULT_CLI_PATH}/lib/api.js`) as CliApi;
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    return null;
  }

  const account = auth.getGlobalDefaultAccount();
  const token = account?.tokens?.refresh_token;
  if (!account || !token) return null;

  if (!existsSync(ADC_PATH)) {
    mkdirSync(resolve(process.cwd(), '.local'), {recursive: true});
    writeFileSync(
      ADC_PATH,
      // The CLI's OAuth client id and secret are public constants shipped in
      // firebase-tools; they identify the CLI and authorise nothing on their own.
      JSON.stringify(
        {
          type: 'authorized_user',
          client_id: api.clientId(),
          client_secret: api.clientSecret(),
          refresh_token: token,
        },
        null,
        2,
      ),
      {mode: 0o600},
    );
  }

  process.env.GOOGLE_APPLICATION_CREDENTIALS = ADC_PATH;
  return account.user?.email ?? 'unknown';
}
