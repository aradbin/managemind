// New keys for the owner's one-time setup (phase-5a-plan §1), and for
// previews that have none of their own:
//
//   pnpm --filter @managemind/scripts keys            prints them to copy
//   pnpm --filter @managemind/scripts keys --outputs  step outputs, masked (previews)
//
// CREDENTIALS_KEY encrypts stores' credentials (ADR 0024); VAPID_* sign web
// push (phase-5a-plan §3.9). Keep a copy of CREDENTIALS_KEY offline: a lost
// key makes every saved credential unreadable.
import { mask, parseArgs, setOutput } from './lib/actions';

const toBase64Url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const credentialsKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
])) as CryptoKeyPair;
const vapidPublic = toBase64Url(
  new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
);
const vapidPrivate = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d as string;

if (parseArgs(process.argv.slice(2)).has('outputs')) {
  mask(credentialsKey);
  mask(vapidPrivate);
  setOutput('credentials_key', credentialsKey);
  setOutput('vapid_public', vapidPublic);
  setOutput('vapid_private', vapidPrivate);
} else {
  console.log(`CREDENTIALS_KEY (repository secret):    ${credentialsKey}`);
  console.log(`VAPID_PRIVATE_KEY (repository secret):  ${vapidPrivate}`);
  console.log(`VAPID_PUBLIC_KEY (repository variable): ${vapidPublic}`);
}
