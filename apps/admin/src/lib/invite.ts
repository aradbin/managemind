// The invitation token rides in the link's fragment (/invite#t=…), so no
// server ever logs it (phase-1-plan §5.6). It's kept in this tab's session
// storage while the invitee signs in, and dropped from the address bar.
const KEY = 'mm.invite';

/** Moves a token from the URL fragment into session storage. */
export function captureInviteToken(): void {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('t');
  if (!token) return;
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // No storage: the token is lost after sign-in; the link still works when opened again.
  }
  history.replaceState(history.state, '', window.location.pathname + window.location.search);
}

export function inviteToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetInviteToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}
