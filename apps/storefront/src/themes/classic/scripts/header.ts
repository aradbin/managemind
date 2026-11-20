// The header's islands (design/storefront-redesign: SiteHeader, PhoneHeader):
// - the slim bar pinned to the top once the full header scrolls away (a
//   separate fixed bar, so nothing on the page jumps);
// - suggestions under the search field: the store's categories that match,
//   then "See all results". Matching products need a cached suggestions
//   endpoint (DECISIONS.md, "Needs platform work" 5).

const header = document.querySelector<HTMLElement>('.site-header');
const pinned = document.querySelector<HTMLElement>('[data-pinned]');
if (header && pinned) {
  let queued = false;
  const update = () => {
    queued = false;
    const past = header.getBoundingClientRect().bottom < 0;
    if (pinned.hidden === past) {
      pinned.hidden = !past;
      document.body.classList.toggle('pinned', past);
    }
  };
  addEventListener(
    'scroll',
    () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}

const input = document.getElementById('q') as HTMLInputElement | null;
const box = document.getElementById('q-suggest');
if (input && box) {
  const categories = JSON.parse(box.dataset.categories ?? '[]') as { name: string; href: string }[];
  const fold = (s: string) => s.normalize('NFC').toLowerCase().trim();
  let options: HTMLAnchorElement[] = [];
  let active = -1;
  const close = () => {
    box.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const mark = (i: number) => {
    active = i;
    for (const [j, o] of options.entries()) o.setAttribute('aria-selected', String(j === i));
    const o = options[i];
    if (o) input.setAttribute('aria-activedescendant', o.id);
  };
  const option = (id: string, href: string, text: string) => {
    const a = document.createElement('a');
    a.id = id;
    a.href = href;
    a.setAttribute('role', 'option');
    a.setAttribute('aria-selected', 'false');
    a.textContent = text;
    a.tabIndex = -1;
    return a;
  };
  const draw = () => {
    const q = fold(input.value);
    while (box.firstChild) box.removeChild(box.firstChild);
    options = [];
    if (q.length < 2) return close();
    const matches = categories
      .filter((c) => fold(c.name).includes(q))
      .sort((a, b) => Number(!fold(a.name).startsWith(q)) - Number(!fold(b.name).startsWith(q)))
      .slice(0, 5);
    if (matches.length) {
      const heading = document.createElement('p');
      heading.className = 'suggest-heading';
      heading.textContent = box.dataset.heading ?? '';
      heading.setAttribute('role', 'presentation');
      box.appendChild(heading);
      matches.forEach((c, i) => {
        const o = option(`q-s${i}`, c.href, c.name);
        options.push(o);
        box.appendChild(o);
      });
    }
    const all = option(
      'q-sall',
      `${box.dataset.search ?? '/search'}?q=${encodeURIComponent(input.value.trim())}`,
      (box.dataset.all ?? '').replace('{q}', input.value.trim()),
    );
    all.classList.add('suggest-all');
    options.push(all);
    box.appendChild(all);
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mark(Math.min(options.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mark(Math.max(-1, active - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      options[active]?.click();
    } else if (e.key === 'Escape') {
      close();
    }
  });
  // A click on a suggestion lands before the blur closes the list.
  box.addEventListener('mousedown', (e) => e.preventDefault());
  input.addEventListener('blur', close);
}

export {};
