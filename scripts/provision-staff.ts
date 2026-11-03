/**
 * Creates or updates a staff member: a Firebase Auth user plus the restaurant
 * staff document that authorizes them.
 *
 *   npm run staff:provision -- --email waiter@example.com --name "Name" --role waiter
 *   npm run staff:provision -- --email waiter@example.com --deactivate
 *
 * Deactivating sets active=false, which every privileged callable re-checks, so
 * access is revoked on the next request (T15).
 */
import {randomBytes} from 'node:crypto';
import {auth, restaurant, requireConfirmation, PROJECT_ID, RESTAURANT_ID} from './admin-app';
import {STAFF_ROLES, type StaffRole} from '../src/lib/contracts';

type Args = {email?: string; name?: string; role: StaffRole; deactivate: boolean; password?: string};

function parseArgs(argv: string[]): Args {
  const args: Args = {role: 'waiter', deactivate: false};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--email') args.email = argv[++i];
    else if (flag === '--name') args.name = argv[++i];
    else if (flag === '--role') args.role = argv[++i] as StaffRole;
    else if (flag === '--password') args.password = argv[++i];
    else if (flag === '--deactivate') args.deactivate = true;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) throw new Error('--email is required');
  if (!STAFF_ROLES.includes(args.role)) throw new Error(`--role must be one of ${STAFF_ROLES.join(', ')}`);
  requireConfirmation('provision staff');
  console.log(`project=${PROJECT_ID} restaurant=${RESTAURANT_ID}`);

  const user = await auth.getUserByEmail(args.email).catch(() => null);

  if (args.deactivate) {
    if (!user) throw new Error(`No account for ${args.email}`);
    await restaurant().collection('staff').doc(user.uid).set({active: false, deactivatedAt: new Date()}, {merge: true});
    console.log(`Deactivated ${args.email}. Access is revoked on their next request.`);
    return;
  }

  // A generated password is printed once; the staff member changes it at first
  // sign-in. Nothing is written to disk.
  const password = args.password ?? randomBytes(9).toString('base64url');
  const record =
    user ?? (await auth.createUser({email: args.email, password, displayName: args.name, emailVerified: false}));

  await restaurant().collection('staff').doc(record.uid).set(
    {
      name: args.name ?? record.displayName ?? args.email,
      email: args.email,
      role: args.role,
      active: true,
      updatedAt: new Date(),
    },
    {merge: true},
  );

  console.log(`Staff ${args.email} is active as ${args.role} (uid ${record.uid}).`);
  if (!user) console.log(`Temporary password: ${password}\nShare it in person and have them change it at first sign-in.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
