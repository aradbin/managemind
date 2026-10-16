# ADR 0016: Image uploads through the API Worker

- Status: Accepted
- Date: 2026-10-15
- Plan: phase-2-plan §3.6 (Q2, Q3). Code: `apps/api/src/admin/media.ts`, `packages/core/src/catalog/media.ts`, `packages/shared/src/catalog/media.ts`, migration 0013

## Context

PLAN.md proposed signed upload URLs straight to R2. On R2, a presigned PUT can't limit the object's size or check its type, so a signed URL would let a browser store anything of any size under the store's prefix. The Free plan also can't resize images in a Worker. Shoppers' phones on 4G need small images, and phone photos carry GPS data in EXIF.

## Decision

1. **The admin resizes in the browser** to 400, 800 and 1200 px wide, keeping orientation and dropping EXIF. Android encodes WebP; iPhones get JPEG at quality 0.82, because Safari can't encode WebP (Q2). Originals up to 15 MB are read on the phone and never uploaded.
2. **Each resized file goes through the API Worker** with the R2 binding: `PUT /v1/admin/media/files/<sha256>.<ext>`, one request per width. The Worker checks:
   - the size (at most 2 MB), from `Content-Length` and again from the body;
   - the type, from the first bytes (JPEG, PNG or WebP), which must match the extension;
   - the body's SHA-256 against the name.
   It stores the file at `tenants/<id>/media/<sha256>.<ext>` (`objectKey`), and doesn't write a file that is already there. No S3 keys and no CORS rules are needed.
3. **CSRF:** staff writes must be JSON (phase-1-plan §5.5). This one path also accepts `image/webp`, `image/jpeg` and `image/png` bodies, which a cross-site form can't send without a preflight; the Origin check still applies.
4. **`POST /media` registers the image** from its files' hashes, widths and sizes, after checking each file exists in R2 with that size. The largest file's hash is the image's identity, unique per store, so the same upload again returns the same row. Only exact re-uploads are caught: the same photo resized on two phones gives different bytes and is stored twice (about 150 KB), which isn't worth more machinery.
5. **Usage and cleanup:** an image is unused (`unused_since`) until a product or variant takes it, and again once nothing does. Every Friday morning in Dhaka, the daily job calls `app.media_cleanup()`, a SECURITY DEFINER function owned by `mm_system`: it deletes images unused for 7 days and returns the files no remaining image of the same store refers to, which the job deletes from R2.
6. **The admin's previews** read files through `GET /v1/admin/media/files/<name>`, from the store's own prefix only. Shoppers will get them from the storefront's `/media/*` (Phase 3), cached for a year since names never change.
7. **Images by URL** (the import's image step, Q8) go through `POST /media/fetch`, because most hosts refuse cross-origin requests: `http(s)` only, default ports, no IP literals or internal names, at most 3 redirects (each checked again), images only (not SVG), at most 15 MB, streamed through without buffering, and rate-limited per store (2,000 an hour, 10,000 a day). The browser then resizes and uploads them like any other photo.

## Consequences

- Uploads cost Worker requests (3 per image) and a little CPU for the hash: about 1 ms for a typical 100–150 KB file. A 2 MB file is the worst case.
- R2 writes: 3 per new image; re-uploads cost a `head` only.
- Files uploaded but never registered (a closed tab between the uploads and `POST /media`) stay in R2 with no row. They are rare and small; a sweep can list and remove them later if they ever matter.
- The fetch route is a proxy to the internet for signed-in staff with `catalog.write`, limited by the rules above and the rate limit. Workers can't reach private networks, and the URL rules keep obvious internal names out anyway.
