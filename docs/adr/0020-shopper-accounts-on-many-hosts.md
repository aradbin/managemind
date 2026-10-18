# ADR 0020: Shopper accounts on many hosts

- Status: Accepted
- Date: 2026-10-17
- Plan: phase-4-plan §3.11, §6.1, Q3. Code: `apps/api/src/store/shopper-auth.ts`, `apps/api/src/store/account.ts`, `packages/core/src/customers/shoppers.ts`, `apps/storefront/src/themes/classic/templates/Account.astro`
- Settles: ADR 0005's open question (one shopper instance serving many store hosts)

## Context

ADR 0005 proved Better Auth's shopper instance in the `store` schema, one store per transaction under RLS, but on one host per store path. In production every store has its own host (`{slug}.managemind.store` or a custom domain, ADR 0019), and a host can be added at any time. Pages are cached at the edge (ADR 0007, ADR 0018), so nothing about a signed-in shopper may reach a page request.

## Decision

1. **One Better Auth instance per request, built for the store's host.** `baseURL` and the only trusted origin are `https://{host}`, from `X-Forwarded-Host` over the service binding (the tenant comes from nowhere else). The instance runs inside the store's transaction, so the Drizzle adapter sees only that store's `shopper_*` rows. Building an instance has no database cost, and sign-in requests are rare.
2. **A per-store signing secret:** HKDF-SHA-256 of `AUTH_SECRET`, salted with the tenant ID. A session token signed for one store fails the signature check on another, on top of RLS hiding the row. The cookie cache stays off (ADR 0005).
3. **The session cookie is `__Secure-mm_session`, `Path=/api`, HttpOnly, SameSite=Lax.** Every auth cookie has `Path=/api`, so page requests never carry it and pages stay cacheable; the account page is a cached shell whose script calls `/api/account`. The storefront's cache also skips any request carrying `mm_session`, as a second guard.
4. **The request Better Auth sees is rewritten** to `https://{host}/api/auth/...`, with the store's own origin as its `Origin`. The storefront proxy has already compared the browser's `Origin` with the page's host, so it stands in for the browser's.
5. **Only four endpoints are reachable:** send a code, sign in with it (a new email creates the account), get the session, sign out. Everything else answers 404, as for staff.
6. **Accounts are off by default** (Q3). Every `/api/auth/*` and `/api/account/*` route answers 404 unless the store turned them on *and* shopper email can go out (ADR 0022); the admin refuses to turn them on before that.
7. **Limits before any auth work:** codes per IP and per store and email, code checks per store and email with the lockout (ADR 0006), and Turnstile on code requests (phase-4-plan §3.15).
8. **The cart follows the shopper.** Signing in merges the guest cart into the shopper's (quantities add up, capped); a cart from an earlier visit gets a new token, since only its hash is stored. Signing out clears the cart cookies, so a shared computer keeps neither.
9. **What an account shows:** the shopper's name, email and phone, orders placed while signed in, and saved addresses in their own table (`store.shopper_addresses`, migration 0025). **Guest orders are not linked by phone,** and customer addresses aren't read by phone: nobody has verified that the shopper owns that number. Phase 5A's phone codes can link them safely.

## Consequences

- A new store host needs nothing: the instance is built for whatever host the request came from.
- Rotating `AUTH_SECRET` signs every shopper out of every store, as it does staff.
- A session check costs a Better Auth instance and one query; it runs only on the account routes and at checkout, never on page or cart requests.
- The Node test runtime lets a response body be cloned after it was moved; Workers doesn't. The sign-in handler reads its clone first, and the browser check on `wrangler dev` caught the difference.
