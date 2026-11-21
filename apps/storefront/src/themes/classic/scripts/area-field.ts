// The searchable Area field (AreaField.astro), for checkout and the account's
// saved addresses: a few letters of the thana, upazila or district, in either
// language, list the matching areas with their district and division; arrow
// keys and Enter pick, and the pick shows as a card with Change. The
// geography file is cached for a year, so the search runs here.
import { config, el, t } from './shop';

export interface GeoFile {
  v: string;
  d: [number, string, string][];
  s: [number, number, string, string][];
  a: [number, number, string, string][];
}

const cfg = config();
let geo: Promise<GeoFile> | null = null;

/** The geography file, fetched once per page. */
export function loadGeo(): Promise<GeoFile> {
  geo ??= fetch(cfg.geo ?? '/geo/bd.json').then((r) => r.json() as Promise<GeoFile>);
  return geo;
}

/** A row's name in the page's language (rows end with the Bangla, then the English name). */
export const placeName = (n: [unknown, ...unknown[]]) =>
  String(cfg.locale === 'bn' ? n[n.length - 2] : n[n.length - 1]);

export interface AreaField {
  /** Shows an area as chosen, as a reload or a saved address does (no onPick). */
  choose(areaId: number): void;
  /** Back to an empty search. */
  clear(): void;
  /** The search field, or Change when an area is chosen: where focus goes for an error. */
  focusTarget(): HTMLElement | null;
}

export function setupAreaField(
  root: HTMLElement,
  geo: GeoFile,
  onPick: (areaId: number) => void,
): AreaField | null {
  const input = root.querySelector<HTMLInputElement>('[role=combobox]');
  const list = root.querySelector<HTMLUListElement>('[role=listbox]');
  const search = root.querySelector<HTMLElement>('[data-area-search]');
  const chosen = root.querySelector<HTMLElement>('[data-area-chosen]');
  const division = root.querySelector<HTMLInputElement>('[data-area-division]');
  const district = root.querySelector<HTMLInputElement>('[data-area-district]');
  const areaInput = root.querySelector<HTMLInputElement>('[data-area-id]');
  const change = root.querySelector<HTMLButtonElement>('[data-area-change]');
  if (!input || !list || !search || !chosen || !division || !district || !areaInput) return null;
  const fold = (text: string) => text.normalize('NFC').toLowerCase();
  const districts = new Map(geo.s.map((x) => [x[0], x]));
  const divisions = new Map(geo.d.map((x) => [x[0], x]));
  type Match = { area: GeoFile['a'][number]; rank: number };
  let matches: Match[] = [];
  let active = -1;

  const placeText = (a: GeoFile['a'][number]) => {
    const s = districts.get(a[1]);
    const d = s ? divisions.get(s[1]) : undefined;
    return [s ? placeName(s) : '', d ? placeName(d) : ''].filter(Boolean).join(', ');
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const mark = (i: number) => {
    active = i;
    for (const [j, li] of [...list.children].entries()) {
      li.setAttribute('aria-selected', String(j === i));
    }
    const li = list.children[i] as HTMLElement | undefined;
    if (li) {
      input.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
  };
  const show = (areaId: number): boolean => {
    const a = geo.a.find((x) => x[0] === areaId);
    const s = a ? districts.get(a[1]) : undefined;
    if (!a || !s) return false;
    areaInput.value = String(a[0]);
    district.value = String(s[0]);
    division.value = String(s[1]);
    const nameEl = chosen.querySelector('[data-area-name]');
    const placeEl = chosen.querySelector('[data-area-place]');
    if (nameEl) nameEl.textContent = placeName(a);
    if (placeEl) placeEl.textContent = placeText(a);
    chosen.hidden = false;
    search.hidden = true;
    close();
    return true;
  };
  const pick = (areaId: number) => {
    if (show(areaId)) onPick(areaId);
  };
  const draw = () => {
    const q = fold(input.value.trim());
    while (list.firstChild) list.removeChild(list.firstChild);
    matches = [];
    if (q.length < 2) return close();
    for (const area of geo.a) {
      const own = [fold(area[2]), fold(area[3])];
      const s = districts.get(area[1]);
      const parent = s ? [fold(s[2]), fold(s[3])] : [];
      const rank = own.some((n) => n.startsWith(q))
        ? 0
        : own.some((n) => n.includes(q))
          ? 1
          : parent.some((n) => n.startsWith(q))
            ? 2
            : -1;
      if (rank >= 0) matches.push({ area, rank });
    }
    matches.sort(
      (x, y) => x.rank - y.rank || placeName(x.area).localeCompare(placeName(y.area), cfg.locale),
    );
    matches = matches.slice(0, 8);
    if (!matches.length) {
      list.appendChild(
        el('li', {
          class: 'area-none',
          role: 'option',
          'aria-disabled': 'true',
          text: t('checkout.areaNone', { q: input.value.trim() }),
        }),
      );
    }
    for (const [i, m] of matches.entries()) {
      const li = el(
        'li',
        {
          id: `${input.id}-o${i}`,
          role: 'option',
          'aria-selected': 'false',
          'data-area': String(m.area[0]),
        },
        el('strong', { text: placeName(m.area) }),
        el('span', { class: 'hint', text: placeText(m.area) }),
      );
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => pick(m.area[0]));
      list.appendChild(li);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      if (list.hidden) draw();
      mark(Math.min(matches.length - 1, active + 1));
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      mark(Math.max(0, active - 1));
    } else if (e.key === 'Enter' && !list.hidden) {
      e.preventDefault();
      const m = matches[Math.max(0, active)];
      if (m) pick(m.area[0]);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('blur', close);
  const clear = () => {
    chosen.hidden = true;
    search.hidden = false;
    areaInput.value = '';
    district.value = '';
    division.value = '';
    input.value = '';
    close();
  };
  change?.addEventListener('click', () => {
    clear();
    input.focus();
  });
  return {
    choose: (areaId) => void show(areaId),
    clear,
    focusTarget: () => (search.hidden ? change : input),
  };
}
