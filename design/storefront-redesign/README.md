# Storefront redesign (design canvas)

The source of the general-store storefront redesign: desktop and phone boards for every shopper-facing page, built on the `classic` theme's `general` preset. The published canvas is a private claude.ai artifact (Design type): https://claude.ai/artifact/4FbGnnuZvYhJXKHWHpkJwt. Its owner shares it from the page's Share menu. This folder is what the canvas is built from, so it can be republished or rebuilt in any session.

Why each choice was made, and what still needs platform work, is in [DECISIONS.md](DECISIONS.md).

## Layout

- `canvas/project/` – what gets published. Each `*.dc.html` file is one board; `canvas.json` places them on the canvas (one row per page: desktop on the left, phone beside it).
- `files-map.mjs` – prints the `files` map a publish call needs (see below).

| Row | Desktop | Phone |
| --- | --- | --- |
| Home | `Main` | `HomePhone`, `HomePhoneBn` (Bangla) |
| Category listing | `Listing` | `ListingPhone` |
| Search results | `Search` | `SearchPhone` |
| Product | `Product` | `ProductPhone` |
| Cart | `Cart` | `CartPhone` |
| Checkout | `Checkout` | `CheckoutPhone` |
| Order tracking | `Track` | `TrackPhone` |
| Shared components and states | `SiteHeader`, `SiteFooter`, `ProductCard`, `QuickAdd` | `PhoneHeader`, `PhoneFooter`, `States` |

The component boards are mounted by the pages with `<dc-import name="…">`. Change a component once and every page that uses it changes.

## The board format, in short

Each board is a Design Component page:

- markup inside `<x-dc>`, with inline styles (the canvas's properties panel edits those);
- `{{name}}` holes filled from `renderVals()` in the `<script type="text/x-dc" data-dc-script>` block at the bottom: dotted lookups only, no expressions;
- `<sc-for list="{{items}}" as="item">` for lists, `<sc-if value="{{flag}}">` for branches, `onClick="{{handler}}"` for events;
- `<dc-import name="ProductCard" item="{{p}}" on-add="{{addOne}}">` mounts `ProductCard.dc.html`; kebab-case attributes arrive as camelCase props;
- `data-props` on the script tag declares the canvas tweaks (here only `primary`, the theme's primary colour).

Sample products, prices and copy live in each board's `renderVals()`. Phone boards are 390 px wide and use `min-height`, so `canvas.json` must give them a frame tall enough for their content (over-tall is fine, clipped is not).

## Republishing in a later session

Ask Claude to republish this folder to the canvas. The publish call is the Artifact tool with:

- `url`: `https://claude.ai/artifact/4FbGnnuZvYhJXKHWHpkJwt`
- `root`: `design/storefront-redesign/canvas`
- `file_path`: `design/storefront-redesign/canvas/project/canvas.json` (absolute path)
- `files`: the output of `node design/storefront-redesign/files-map.mjs --except=canvas.json`

Before republishing, read the live canvas first (Artifact `read` on `project/canvas.json` and the boards you will overwrite): people can edit boards in the page, and a publish over a newer edit is refused. Merge their changes into these files, publish, then commit the merged files here.

To start a fresh canvas instead (another account, or a clean copy), create a new artifact from the Design type (Artifact `quickstart` with intent `design`, then publish with the type's `type_url` and a title), then publish these files to the new URL the same way and update the link above.

## Pulling canvas edits back into the repo

If someone edits the canvas in the browser, read the changed files with the Artifact tool (`read` with `paths`), copy them over `canvas/project/`, and commit. The canvas and this folder should always match.

This folder is excluded from Biome: the board scripts are fragments that only run inside the canvas runtime.
