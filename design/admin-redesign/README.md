# Admin redesign (design canvas)

The source of the admin redesign canvas: the default shadcn theme, compact, with desktop (1440×900) and phone (390×844) boards for every admin page. The published canvas is a private claude.ai artifact; this folder is what it is built from.

## Layout

- `canvas/project/` – the boards (`*.dc.html`) and `canvas.json` (board positions and order). This is what gets published.
- One folder per area, each with a Python builder and the boards' JavaScript:
  - `inv/` inventory (`build.py` holds the shared shell, icons and helpers every later builder imports)
  - `ord/` orders, returns
  - `rep/` reports and Home
  - `set/` settings and billing
  - `web/` online store
  - `misc/` sign-in, two-factor, invite, account, print layouts
  - `plat/` platform admin
  - `imp/` customer, supplier and expense imports
  - `attr/`, `cust/`, `exp/`, `promo/`, `import/` hold the sources of earlier hand-built boards (attributes, customers, expenses, promotions, product import).
- `wire.py` – links the boards to each other (sidebar, phone menu, tab bar, avatar, Import buttons). Run it after any build.

## Rebuilding

Run everything from this folder; the builders write into `canvas/project/`.

```sh
python3 inv/build.py            # inventory
python3 ord/obuild.py           # orders (or name pages: python3 ord/obuild.py orders order)
python3 rep/rbuild.py           # reports and Home
python3 set/sbuild.py           # settings
python3 web/wbuild.py           # online store
python3 misc/mbuild.py          # sign-in, account, print
python3 plat/pbuild.py          # platform admin
python3 imp/ibuild.py           # imports
python3 wire.py                 # always last
```

## Checking

- `node smoke2.cjs canvas/project/X.dc.html '{"startOn":"State"}'` renders one state and lists values the markup uses but the script doesn't provide. Misses that are only children of an empty list, or loop names reused across lists, are false positives.
- `./osnap.sh Board [p] "State" …` screenshots states into `shots/` (needs Playwright with Chromium); `p` takes the phone board.
- `node render.cjs in.dc.html out.html '{"startOn":"State","dark":true}'` then `node shot2.cjs out.html out.png 1440 900` for dark mode.
- `node otest.cjs canvas/project/X.dc.html "State" tests/t1.js` runs an interaction script against a board (`tests/` has the ones used for the order pages).
- `python3 keys.py path/to/page.tsx` (run from `apps/admin/src`) prints a page's English copy, to keep boards' wording the same as the app.

This folder is excluded from Biome: the board scripts are fragments that only run inside the canvas runtime.
