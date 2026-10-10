// A just-created workers.dev Worker can answer 404 for a few seconds. Wait
// until both Workers serve before any test runs.
import { API, STOREFRONT } from './urls';

export default async function waitForDeploy(): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (const url of [`${API}/health`, `${STOREFRONT}/?store=demo-fashion`]) {
    for (;;) {
      const status = await fetch(url).then(
        (r) => r.status,
        () => 0,
      );
      if (status === 200) break;
      if (Date.now() > deadline) throw new Error(`${url} still answers ${status}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
