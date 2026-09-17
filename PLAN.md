# Shelf — Implementation Plan (source of truth)

> A private, per-user manga/comic library and reader. Upload archives, a background
> worker extracts and optimizes pages into Cloudflare R2, metadata lives in MongoDB,
> and a polished reader syncs progress across devices.

This document is the source of truth. If implementation must deviate, update this
file first (Decisions log, with the reason), then write the code.

---

## 1. Project overview and scope

**Product.** Shelf is a personal comic/manga reader for files the user already owns.
A user uploads archives (CBZ/ZIP, CBR/RAR, CB7/7z, PDF, EPUB, or a folder of images).
A BullMQ worker extracts, cleans, normalizes, and optimizes pages, uploads them to
Cloudflare R2, and records metadata in MongoDB. The reader is fast, keyboard- and
touch-friendly, and syncs reading progress.

**In scope**
- Email + password auth with JWT access/refresh, session rotation, reuse detection.
- **Invite-based signup** (invite-only instance) and **per-series sharing**: a series owner
  invites other users as readers; invited users can read but not modify. No public content.
- Direct-to-R2 uploads via presigned URLs (single PUT and multipart).
- Background ingestion pipeline with live progress over SSE.
- Library of series, chapters, pages, per-user progress, settings, per-owner storage quota.
- **Two readers**: (a) an image/page e-reader — webtoon (vertical), single page, double page,
  RTL/LTR, fit modes, zoom, preloading, progress sync; (b) a **native document reader** for
  PDF (PDF.js) and EPUB (epub.js text reflow), chosen per file.
- **Format choice on the fly**: for PDF/EPUB the uploader picks how to store/read it —
  optimized page images (WebP) or keep-original + native reader. The UI offers only the
  conversions actually possible for that file.
- Redis caching, rate limiting, token revocation; graceful degradation.
- Dockerized worker + Redis + optional app for the Oracle Cloud VM.

**Non-goals (hard constraints)**
- No public content and no discovery. Content is visible only to a series' owner and the
  users that owner has explicitly invited. Invite-only: no open self-serve signup.
- No scraping or fetching content from third-party sites. Uploads only.
- No payment, no multi-tenant org features, no social features (comments, follows, feeds).

**Access model.** Every content resource has an `ownerId` (the series owner). Access is
granted by **series membership** (`SeriesMember`: owner or reader), not by `ownerId` equality.
Every query is scoped through service functions that resolve the caller's memberships;
mutations are restricted to the owner. A resource the caller cannot access returns **404**,
never 403, to avoid leaking existence. Progress, settings, and sessions remain strictly
per-user (keyed by the caller's `userId`).

---

## 2. Final tech stack (exact package names)

**Runtime / framework (already installed)**
- `next@16.3.5` (App Router), `react@19.2.8`, `react-dom@19.2.8`, `typescript@^5` (strict)
- `tailwindcss@^4`, `@tailwindcss/postcss@^4`

**To add — app + shared**
- UI: `shadcn` (CLI-generated components), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tailwindcss-animate`, `next-themes`, `sonner` (toasts)
- Native document readers (client): `pdfjs-dist` (PDF viewer with text layer), `epubjs` (EPUB text reflow)
- PWA: **no build plugin** — hand-rolled `app/manifest.ts` (typed Web App Manifest) + a minimal
  `public/sw.js` service worker registered from a client provider, and a custom install button driven
  by `beforeinstallprompt`. (Decision D16: avoids coupling to next-pwa/serwist bundler hooks, which may
  not support this modified Next 16 build. Icons generated with `sharp` from one source SVG.)
- Data client: `@tanstack/react-query`, `@tanstack/react-query-devtools`
- Validation: `zod`
- DB: `mongoose`
- Redis: `ioredis`
- Queue: `bullmq`
- R2 / S3: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- Auth: `jose`, `argon2`
- Rate limiting: `rate-limiter-flexible`
- Logging: `pino`, `pino-http` (dev pretty: `pino-pretty`)
- Server-only guard: `server-only`
- Misc: `nanoid` (ids where not using Mongo ObjectId)

**To add — worker (ingestion)**
- Image: `sharp`
- Archives: `yauzl` (ZIP/CBZ/EPUB), `node-unrar-js` (RAR/CBR), `node-7z` + `7zip-bin` (7z/CB7)
- PDF: `pdfjs-dist` (render pages to raster via canvas) with `@napi-rs/canvas` as the canvas backend; fallback evaluated in Phase 7 (`pdf-to-img`)
- Detection: `file-type`
- Temp files: node built-ins (`fs/promises`, `os.tmpdir`)

**To add — tooling / tests**
- `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
- `@playwright/test`
- `prettier`, `prettier-plugin-tailwindcss`
- `tsx` (run the worker in dev), `dotenv` (worker process env loading)
- `eslint` (already), plus rules already provided by `eslint-config-next`

**Node / package manager.** Node 22, npm (package-lock.json present).

> Decision: `pdfjs-dist` + `@napi-rs/canvas` chosen over `pdf-to-img` initially because it
> gives per-page control and progress; revisit in Phase 7 if canvas install is painful on the VPS.

---

## 3. Architecture

### 3.1 Component diagram

```
                    ┌─────────────────────────────────────────────┐
                    │                  Browser                     │
                    │  Next.js RSC/Client + TanStack Query         │
                    └───────┬───────────────────────┬─────────────┘
                            │ httpOnly cookies       │ presigned PUT/GET
                            │ (access/refresh JWT)    │ (direct, no proxy)
                            ▼                         ▼
        ┌───────────────────────────────┐    ┌──────────────────────┐
        │      Next.js App (API)         │    │   Cloudflare R2       │
        │  proxy.ts (edge auth check)    │    │   (private bucket)    │
        │  route handlers (node runtime) │    │  uploads/raw/...      │
        │  services (userId-scoped)      │    │  library/...          │
        └───┬───────────┬───────────┬────┘    └──────────▲───────────┘
            │           │           │                    │
     Mongoose      ioredis      @aws-sdk           streams raw / writes pages
            │           │           │                    │
            ▼           ▼           ▼                    │
      ┌─────────┐  ┌─────────┐  ┌──────────┐      ┌──────┴───────────┐
      │ MongoDB │  │  Redis  │  │ presign  │      │  Worker (Node)   │
      │         │  │ cache / │  │ signer   │      │  BullMQ consumer │
      │         │  │ RL /    │  │          │      │  adapters+sharp  │
      │         │  │ denylist│  └──────────┘      │  /worker         │
      │         │  │ BullMQ  │◀─────────────────▶ │                  │
      └─────────┘  └─────────┘   jobs+events      └──────────────────┘
```

The R2 bucket is private. All reads/writes go through presigned URLs issued only
after a `userId` ownership check.

### 3.2 Request flows

**Upload (single PUT, < 100 MB)**
1. `POST /api/uploads/presign` → auth, rate limit (upload tier), quota check, sanitize
   filename, create `Upload` doc (status `pending`), return presigned `PutObject` URL
   bound to key + `ContentType` + `ContentLength`.
2. Browser `PUT`s file bytes directly to R2 (progress via XHR/`fetch` upload stream).
3. `POST /api/uploads/:id/complete` → verify ownership, `HeadObject` to confirm size
   matches, enforce quota again, enqueue BullMQ `ingest` job (jobId = uploadId, idempotent),
   set `Upload.status=processing`, create a `Chapter` (status `queued`) linked to a series.

**Upload (multipart, ≥ 100 MB)**
1. `POST /api/uploads/presign` with `multipart:true` → `CreateMultipartUpload`, store
   `multipartUploadId` on `Upload`, return part size + count.
2. `POST /api/uploads/:id/parts` (batched) → presigned `UploadPart` URLs for a range.
3. Browser PUTs each part, collects ETags.
4. `POST /api/uploads/:id/complete` with parts → `CompleteMultipartUpload`, then as above.
5. `POST /api/uploads/:id/abort` → `AbortMultipartUpload`, mark `Upload.status=aborted`.

**Processing (worker)**
1. Consume `ingest` job → stream raw file from R2 to a unique temp dir.
2. `file-type` magic-byte detection → pick adapter.
3. Adapter yields `RawPage`s (safety limits enforced: entries, uncompressed bytes, ratio, zip-slip).
4. Clean (drop junk, natural sort, split multi-folder into chapters, parse ch/vol numbers).
5. `sharp`: auto-rotate, strip metadata, WebP q82 @ 1600 + 800 (no upscale), 240px thumb; record dims + isSpread.
6. Upload page objects to R2, bulk insert `Page` docs, set cover if missing, update `Chapter`
   (`status=ready`, `pageCount`), bump `Series.chapterCount`, update `User.storageUsedBytes`,
   invalidate Redis version counters, delete raw object + temp files.
7. `job.updateProgress({ stage, done, total })` throughout.
8. On failure: `Chapter.status=failed` + human error, delete partial R2 objects, cleanup temp in `finally`.

**Reading**
1. `GET /api/chapters/:id/pages` → ownership check, read cached presigned URL list from Redis;
   on miss, presign `GetObject` for each page (800 + 1600 + thumb) with `ResponseCacheControl`,
   cache for (PRESIGN_DOWNLOAD_TTL − 5 min), return URLs + dimensions.
2. Browser loads images directly from R2 using presigned URLs (`srcset` picks 800/1600).
3. Reader refreshes URLs before expiry; retries an image once on 403.

**Auth**
- Signup/login → argon2id verify → issue access (15 m) + refresh (30 d) cookies; create `Session`.
- Protected navigation → `proxy.ts` verifies access token (jose, edge) → allow or redirect to `/login`.
- API 401 → client calls `POST /api/auth/refresh` once → rotates refresh (reuse detection) → retries.
- Logout → revoke session + denylist access `jti` in Redis until exp. Logout-all → revoke all sessions + bump `tokenVersion`.

---

## 4. Folder structure

```
my-manga-world/
├─ PLAN.md
├─ README.md
├─ .env.example
├─ Dockerfile.worker
├─ docker-compose.yml
├─ next.config.ts            # security headers, image/remote config
├─ proxy.ts (src/proxy.ts)   # Next 16 middleware replacement (edge auth check)
├─ vitest.config.ts
├─ playwright.config.ts
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/page.tsx            # landing, redirects signed-in → /library
│  │  ├─ login/page.tsx
│  │  ├─ signup/page.tsx                    # requires ?invite=<token> when SIGNUPS_OPEN=false
│  │  ├─ accept/[token]/page.tsx            # invite landing (preview + accept / route to signup)
│  │  ├─ (app)/library/page.tsx
│  │  ├─ (app)/series/[id]/page.tsx         # includes Share panel (members + invite link)
│  │  ├─ (app)/upload/page.tsx              # reader-mode chooser for PDF/EPUB
│  │  ├─ (app)/read/[chapterId]/page.tsx    # dispatches image reader vs native document reader
│  │  ├─ (app)/settings/page.tsx
│  │  ├─ layout.tsx, globals.css, providers.tsx
│  │  └─ api/
│  │     ├─ auth/{signup,login,refresh,logout,logout-all,me,change-password}/route.ts
│  │     ├─ auth/sessions/route.ts, auth/sessions/[id]/route.ts
│  │     ├─ invites/route.ts (list/mint app invites; admin), invites/[token]/route.ts (GET preview + POST accept)
│  │     ├─ uploads/presign/route.ts
│  │     ├─ uploads/[id]/{parts,complete,abort}/route.ts
│  │     ├─ jobs/[id]/route.ts, jobs/[id]/stream/route.ts
│  │     ├─ series/route.ts, series/[id]/route.ts, series/[id]/chapters/route.ts
│  │     ├─ series/[id]/members/route.ts, series/[id]/members/[userId]/route.ts, series/[id]/invites/route.ts
│  │     ├─ chapters/[id]/route.ts, chapters/[id]/pages/route.ts, chapters/[id]/document/route.ts, chapters/[id]/retry/route.ts
│  │     ├─ progress/[chapterId]/route.ts, progress/continue/route.ts
│  │     ├─ settings/route.ts, storage/route.ts
│  │     └─ health/route.ts
│  ├─ components/{ui,library,reader,upload,auth,common}/
│  ├─ lib/
│  │  ├─ env.ts               # Zod-validated env (server)
│  │  ├─ logger.ts            # pino + request ids
│  │  ├─ db.ts                # mongoose singleton + sanitizeFilter
│  │  ├─ redis.ts             # ioredis singleton(s)
│  │  ├─ r2.ts                # S3 client + presign helpers
│  │  ├─ auth/{tokens.ts,session.ts,password.ts,cookies.ts,requireUser.ts,denylist.ts,lockout.ts}
│  │  ├─ cache.ts             # cache-aside + version counters
│  │  ├─ rate-limit.ts        # rate-limiter-flexible tiers
│  │  ├─ errors.ts            # ApiError, error shape, handler wrapper
│  │  ├─ http.ts              # json(), parse+validate, origin check
│  │  └─ validators/          # route-specific Zod schemas
│  ├─ services/               # membership-scoped business logic (access.ts resolves caller's rights)
│  │  ├─ access.ts (assertSeriesRead/assertSeriesOwner), series.service.ts, chapter.service.ts, page.service.ts
│  │  ├─ sharing.service.ts (members + invites), progress.service.ts, upload.service.ts, user.service.ts, storage.service.ts
│  ├─ models/                 # Mongoose models
│  │  ├─ User.ts, Session.ts, SeriesMember.ts, Invite.ts, Series.ts, Chapter.ts, Page.ts, Progress.ts, Upload.ts
│  ├─ lib/shared/             # shared by app + worker (no next imports)
│  │  ├─ types.ts, schemas.ts (Zod job payloads + DTOs), constants.ts, naming.ts (sort/parse)
│  └─ client/                 # api client, query hooks, fetch-with-refresh
├─ worker/
│  ├─ index.ts                # bootstraps workers, graceful shutdown
│  ├─ queues.ts               # queue + QueueEvents definitions (shared names)
│  ├─ processors/{ingest.ts,cleanup.ts,maintenance.ts}
│  ├─ pipeline/{detect.ts,clean.ts,imaging.ts,upload.ts,limits.ts,tempdir.ts}
│  └─ adapters/{index.ts,zip.ts,rar.ts,sevenzip.ts,pdf.ts,epub.ts}
└─ tests/
   ├─ unit/                   # naming, detect, filtering, parsing, sanitize, jwt, rate-limit
   ├─ fixtures/               # tiny CBZ, RAR-as-cbz, zipbomb, zip-slip samples
   └─ e2e/                    # playwright specs
```

> Note: queue/event **names** and job payload **schemas** live in `src/lib/shared` so the
> app (producer) and `worker/` (consumer) agree. The worker imports models + shared libs
> directly (compiled with `tsx`/`tsc`), and connects to Mongo/Redis/R2 with the same `lib/env`.

---

## 5. Data models (Mongoose, all `timestamps: true`)

Common: `_id: ObjectId`. Content models (Series, Chapter, Page) carry `ownerId: ObjectId`
(the series owner, indexed); per-user models (Session, Progress, Upload) carry `userId`.
Access to content is resolved via `SeriesMember`, not `ownerId` equality.
`mongoose.set("sanitizeFilter", true)` globally.

### User
| field | type | notes |
|---|---|---|
| email | string | unique, lowercased, trimmed |
| passwordHash | string | argon2id |
| name | string | optional display name |
| tokenVersion | number | default 0; bumped on logout-all / password change |
| storageUsedBytes | number | default 0; counts only series this user **owns** |
| role | "user" \| "admin" | default "user"; admin can mint app invites and manage the instance. First user (when no users exist, or matching `BOOTSTRAP_ADMIN_EMAIL`) becomes admin |
| settings | subdoc | `{ readingMode: "vertical"\|"single"\|"double", direction: "rtl"\|"ltr", fit: "width"\|"height"\|"original", theme: "light"\|"dark"\|"system", preloadCount: number }` |

Indexes: `{ email: 1 }` unique.

### Session
| field | type | notes |
|---|---|---|
| userId | ObjectId | ref User |
| refreshTokenHash | string | sha-256 of opaque refresh token |
| familyId | string | rotation family; reuse revokes whole family |
| userAgent | string | |
| ip | string | |
| expiresAt | Date | TTL index |
| revokedAt | Date? | |
| replacedBy | ObjectId? | next session in chain |

Indexes: `{ userId: 1 }`, `{ refreshTokenHash: 1 }`, `{ familyId: 1 }`, TTL `{ expiresAt: 1 }, expireAfterSeconds: 0`.

### SeriesMember (sharing)
| field | type | notes |
|---|---|---|
| seriesId | ObjectId | ref Series |
| userId | ObjectId | the member |
| role | "owner" \| "reader" | owner may edit/delete/upload/invite; reader is read-only |
| addedBy | ObjectId | who invited/created |

Indexes: `{ seriesId: 1, userId: 1 }` unique, `{ userId: 1 }` (list all series a user can see), `{ seriesId: 1 }`.
The owner gets an `owner` membership row on series create (single source of truth for access).

### Invite
| field | type | notes |
|---|---|---|
| email | string | lowercased target email |
| tokenHash | string | sha-256 of the opaque invite token (raw token only in the link) |
| kind | "app" \| "series" | app: allows account creation; series: also grants membership |
| seriesId | ObjectId? | required when kind=series |
| role | "reader" | series role granted on accept (owner-only invites are not issued) |
| invitedBy | ObjectId | |
| expiresAt | Date | TTL index; from `INVITE_TTL` |
| acceptedAt | Date? | |
| acceptedBy | ObjectId? | user who accepted |

Indexes: `{ tokenHash: 1 }` unique, `{ email: 1 }`, `{ seriesId: 1 }`, TTL `{ expiresAt: 1 }`.

### Series
| field | type | notes |
|---|---|---|
| ownerId | ObjectId | series owner (storage attributed here) |
| title | string | |
| sortTitle | string | lowercased, article-stripped for sorting |
| coverKey | string? | R2 key |
| description | string? | |
| tags | string[] | |
| chapterCount | number | denormalized |
| memberCount | number | denormalized (owner + readers) |
| lastReadAt | Date? | owner's last read; per-user recency comes from Progress |

Indexes: `{ ownerId: 1, sortTitle: 1 }`, `{ ownerId: 1, lastReadAt: -1 }`. Series a user can see are
found via `SeriesMember { userId }` then loaded by id; search/sort applied in the service.

### Chapter
| field | type | notes |
|---|---|---|
| ownerId | ObjectId | = owning series' ownerId (R2 path + storage) |
| seriesId | ObjectId | ref Series |
| number | number (float) | supports 12.5 |
| title | string? | |
| volume | number? | |
| pageCount | number | default 0 (images mode) |
| status | "queued"\|"processing"\|"ready"\|"failed" | |
| error | string? | human-readable |
| sourceFormat | "zip"\|"rar"\|"7z"\|"pdf"\|"epub"\|"images" | detected source |
| renderMode | "images" \| "document" | how it is read; chosen at upload for PDF/EPUB, else "images" |
| documentKey | string? | R2 key of the kept original (renderMode=document) |
| documentFormat | "pdf" \| "epub" ? | native reader to use (renderMode=document) |
| sizeBytes | number | raw upload size |
| jobId | string? | BullMQ job id (= uploadId) |

Indexes: `{ ownerId: 1, seriesId: 1, number: 1 }`, `{ ownerId: 1, status: 1 }`, `{ jobId: 1 }`.

### Page
| field | type | notes |
|---|---|---|
| chapterId | ObjectId | |
| ownerId | ObjectId | |
| index | number | 0-based order |
| key | string | 1600w webp R2 key |
| key800 | string | 800w webp key |
| thumbKey | string | 240px thumb key |
| width | number | of 1600 variant (intrinsic) |
| height | number | |
| isSpread | boolean | width > height * 1.1 |
| bytes | number | sum of variant bytes |

Indexes: `{ chapterId: 1, index: 1 }` unique, `{ ownerId: 1 }`. (Pages exist only for renderMode=images.)

### Progress
| field | type | notes |
|---|---|---|
| userId | ObjectId | |
| chapterId | ObjectId | |
| seriesId | ObjectId | |
| pageIndex | number | last read |
| completed | boolean | reached end |

Indexes: `{ userId: 1, chapterId: 1 }` unique, `{ userId: 1, seriesId: 1 }`, `{ userId: 1, updatedAt: -1 }` (continue-reading).

### Upload
| field | type | notes |
|---|---|---|
| userId | ObjectId | |
| rawKey | string | uploads/raw/... |
| originalName | string | sanitized |
| size | number | declared ContentLength |
| status | "pending"\|"processing"\|"done"\|"failed"\|"aborted" | |
| multipartUploadId | string? | for multipart |
| jobId | string? | |
| seriesId | ObjectId? | target series (must be a series the user **owns**) |
| chapterMeta | subdoc? | proposed `{ number, title, volume }` |
| renderMode | "images" \| "document" ? | reader-mode choice; only "document" allowed for PDF/EPUB |
| expiresAt | Date | TTL index (2 days) for abandoned uploads |

Indexes: `{ userId: 1 }`, `{ rawKey: 1 }`, TTL `{ expiresAt: 1 }`.

> Note: `Series` models list uses `SeriesMember`; `Progress`/`Upload`/`Session` stay per-`userId`.
> The models directory therefore includes: `User, Session, SeriesMember, Invite, Series, Chapter, Page, Progress, Upload`.

---

## 6. Redis key design

Prefix everything with `shelf:v1:`. Separate logical namespaces below.

**Version counters (invalidation without KEYS/scans)** — with sharing, a content change must
invalidate every member's cached views, so per-series counters are **global** (not per user):
- `shelf:v1:ver:series:{seriesId}` — global; bumped on that series' metadata/chapter/page/status changes.
- `shelf:v1:{userId}:ver:list` — per user; bumped when that user's **membership set** changes
  (invited, removed, series created/deleted) AND when any series they're a member of changes
  (on a content change the service loads the small member set and bumps each member's `ver:list`).
- Cache keys embed the relevant counter value, so stale entries are never read (no KEYS/scan).

**Cache-aside (TTLs)** — `{sver}` = `ver:series:{seriesId}`, `{lver}` = `{userId}:ver:list`.
| key | contents | TTL |
|---|---|---|
| `shelf:v1:{userId}:series:list:{lver}:{hash(query)}` | paginated series list DTO (viewer's memberships) | 120 s |
| `shelf:v1:series:detail:{sver}:{seriesId}` | series detail DTO (shared across members) | 120 s |
| `shelf:v1:series:{seriesId}:chapters:{sver}` | chapter list DTO (shared across members) | 120 s |
| `shelf:v1:{userId}:chapter:{chapterId}:pages:{sver}` | presigned page URL list + dims (per viewer; URLs are per-request) | PRESIGN_DOWNLOAD_TTL − 300 s |
| `shelf:v1:{userId}:continue:{lver}` | continue-reading list DTO | 60 s |
| `shelf:v1:{userId}:storage` | storage usage snapshot (series owned) | 60 s |

`hash(query)` = short sha-256 of normalized query params (search, sort, cursor, limit).

**Auth / security**
| key | contents | TTL |
|---|---|---|
| `shelf:v1:denylist:jti:{jti}` | "1" (revoked access token) | remaining token exp |
| `shelf:v1:lockout:ip:{ip}` / `:email:{email}` | failed-login counter | 15 min sliding |

**Progress (write-through with short cache)**
| key | contents | TTL |
|---|---|---|
| `shelf:v1:{userId}:progress:{chapterId}` | `{ pageIndex, completed, updatedAt }` | 6 h |

> Decision: progress uses **write-through** (write Redis immediately, and upsert Mongo on the
> same request but debounced client-side at 1.5 s + on `visibilitychange`). Reads prefer Redis,
> fall back to Mongo. This keeps cross-device resume correct while limiting Mongo writes.

**Rate limiting** — managed by `rate-limiter-flexible` with keyPrefixes:
`shelf:v1:rl:auth`, `:rl:refresh`, `:rl:upload`, `:rl:write`, `:rl:read`, `:rl:progress`.

**BullMQ** — default BullMQ keyspace under prefix `shelf:v1:bull` (queues: `ingest`, `cleanup`, `maintenance`).
Concurrent-ingest guard: `shelf:v1:{userId}:ingest:active` (integer, INCR on enqueue / DECR on finish; max 5).

**Failure policy.** Cache reads that throw are logged and treated as a miss (fall back to Mongo).
Rate limiting **fails closed on auth routes**, **open elsewhere** (documented in code + README).

---

## 7. R2 key layout

`{userId}` in `uploads/raw` is the uploader; `{ownerId}` in `library` is the series owner.

```
uploads/raw/{userId}/{uploadId}/{sanitizedFileName}
library/{ownerId}/{seriesId}/{chapterId}/{index:04}-1600.webp     # renderMode=images
library/{ownerId}/{seriesId}/{chapterId}/{index:04}-800.webp      # renderMode=images
library/{ownerId}/{seriesId}/{chapterId}/thumbs/{index:04}.webp   # renderMode=images
library/{ownerId}/{seriesId}/{chapterId}/original.{pdf|epub}      # renderMode=document (kept original)
library/{ownerId}/{seriesId}/cover.webp
```

- Bucket is private; no public access. CORS allows `PUT`/`GET` from `APP_URL` only, exposes `ETag` (README).
- Lifecycle rule (README): delete `uploads/raw/` objects older than 2 days.
- `renderMode=document`: the worker still validates the file (and generates a cover thumbnail),
  copies the original to `original.{ext}` under the chapter prefix, and does NOT rasterize pages.
  The native reader streams the original via a presigned GET (`chapters/:id/document`).
- Deletes never remove R2 objects inline; a `cleanup` job deletes prefixes.

---

## 8. API contract

Conventions: all non-auth routes require a valid access token (via cookie). Content routes
additionally require **series membership** (read routes: owner or reader; write routes: owner).
All inputs validated with Zod (body, query, and route params — ObjectId format, unknown
keys rejected via `.strict()`). Error shape everywhere:

```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
```

Common error codes: `UNAUTHENTICATED` (401), `FORBIDDEN`→ mapped to `NOT_FOUND` (404) for
cross-user, `NOT_FOUND` (404), `VALIDATION` (422), `RATE_LIMITED` (429), `QUOTA_EXCEEDED` (413),
`CONFLICT` (409), `INTERNAL` (500). State-changing requests require an Origin/Referer check (CSRF).

Rate-limit tiers referenced below: `auth-strict`, `auth-refresh`, `upload`, `write`, `read`, `progress`.

### Auth
| method | path | auth | RL | request (Zod) | success response |
|---|---|---|---|---|---|
| POST | /api/auth/signup | no | auth-strict | `{ email, password(min12), name?, inviteToken? }` (inviteToken required unless SIGNUPS_OPEN; must match email) | 201 `{ user }` + sets cookies; consumes invite (grants series membership if kind=series) |
| POST | /api/auth/login | no | auth-strict | `{ email, password }` | 200 `{ user }` + cookies (generic error on fail) |
| POST | /api/auth/refresh | cookie | auth-refresh | (refresh cookie) | 200 `{ ok:true }` + rotated cookies |
| POST | /api/auth/logout | yes | write | — | 204, revoke session + denylist jti |
| POST | /api/auth/logout-all | yes | write | — | 204, revoke all + bump tokenVersion |
| GET | /api/auth/me | yes | read | — | 200 `{ user }` |
| POST | /api/auth/change-password | yes | auth-strict | `{ currentPassword, newPassword }` | 204, revoke other sessions |
| GET | /api/auth/sessions | yes | read | — | 200 `{ sessions: [...] }` |
| DELETE | /api/auth/sessions/:id | yes | write | param id | 204 |

### Invites & sharing
| method | path | auth | RL | request | response |
|---|---|---|---|---|---|
| GET | /api/invites/:token | no | read | param token | 200 `{ kind, email, seriesTitle?, invitedByName, expiresAt }` (preview; 404 if invalid/expired) |
| POST | /api/invites/:token | maybe | auth-strict | — | explicit accept: if signed-in and email matches → accept (add membership, mark invite consumed); if signed-in but email differs → 403; if not signed-in → 409 `{ needsAuth:true, email }` (client routes to login/signup, then re-POSTs) |
| POST | /api/invites | admin | write | `{ email }` | 201 `{ inviteUrl }` (mint an app invite) |
| GET | /api/series/:id/members | yes (owner) | read | — | 200 `{ members: [{ userId, name, email, role }] }` |
| GET | /api/series/:id/invites | yes (owner) | read | — | 200 `{ invites: [{ email, expiresAt, acceptedAt? }] }` (pending + recent) |
| POST | /api/series/:id/invites | yes (owner) | write | `{ email }` | 201 `{ inviteUrl }` (always creates a pending invite; membership is granted only when the invitee clicks accept, even if they already have an account) |
| DELETE | /api/series/:id/members/:userId | yes (owner) | write | — | 204 (owner cannot remove self; transfer/delete series instead) |

### Uploads
| method | path | auth | RL | request | response |
|---|---|---|---|---|---|
| POST | /api/uploads/presign | yes (owner of seriesId) | upload | `{ fileName, size, contentType, multipart?:bool, seriesId?, newSeriesTitle?, chapterMeta?, renderMode?: "images"\|"document" }` (renderMode=document only valid for PDF/EPUB; server re-validates) | 200 single: `{ uploadId, url, key }`; multipart: `{ uploadId, key, partSize, partCount }` |
| POST | /api/uploads/:id/parts | yes | upload | `{ partNumbers: number[] }` | 200 `{ urls: [{ partNumber, url }] }` |
| POST | /api/uploads/:id/complete | yes | upload | `{ parts?: [{ partNumber, etag }] }` | 202 `{ uploadId, chapterId, jobId }` |
| POST | /api/uploads/:id/abort | yes | upload | — | 204 |

Presign enforces: size ≤ MAX_UPLOAD_BYTES, quota (storageUsed + size ≤ MAX_STORAGE_BYTES_PER_USER),
concurrent-ingest guard, filename sanitized, `ContentType`/`ContentLength` bound into the signature.
Complete re-verifies via `HeadObject` (actual size matches declared) and re-checks quota.

### Jobs
| method | path | auth | RL | response |
|---|---|---|---|---|
| GET | /api/jobs/:id | yes | read | 200 `{ id, state, progress, chapterId }` (ownership via Chapter.jobId) |
| GET | /api/jobs/:id/stream | yes | read | text/event-stream; events `progress`, `done`, `failed`; closes on completion |

### Series
| method | path | auth | RL | request | response |
|---|---|---|---|---|---|
| GET | /api/series | yes | read | query `{ search?, sort?: "recent"\|"title"\|"added", cursor?, limit?(≤50) }` | 200 `{ items, nextCursor }` |
| POST | /api/series | yes | write | `{ title, description?, tags? }` | 201 `{ series }` |
| GET | /api/series/:id | yes | read | — | 200 `{ series }` |
| PATCH | /api/series/:id | yes | write | `{ title?, description?, tags?, coverKey? }` | 200 `{ series }` |
| DELETE | /api/series/:id | yes | write | — | 202 (enqueues cleanup) |
| GET | /api/series/:id/chapters | yes | read | — | 200 `{ chapters }` |

### Chapters
| method | path | auth | RL | request | response |
|---|---|---|---|---|---|
| GET | /api/chapters/:id | yes | read | — | 200 `{ chapter }` |
| PATCH | /api/chapters/:id | yes | write | `{ number?, title?, volume?, seriesId? }` | 200 `{ chapter }` |
| DELETE | /api/chapters/:id | yes | write | — | 202 (enqueues cleanup) |
| GET | /api/chapters/:id/pages | yes (member) | read | — | 200 `{ renderMode:"images", pages: [{ index, url, url800, thumbUrl, width, height, isSpread }], expiresAt }`; 409 if renderMode=document |
| GET | /api/chapters/:id/document | yes (member) | read | — | 200 `{ renderMode:"document", documentFormat, url, expiresAt }` (presigned GET of the original); 409 if renderMode=images |
| POST | /api/chapters/:id/retry | yes (owner) | write | — | 202 `{ jobId }` (only if status=failed) |

### Progress
| method | path | auth | RL | request | response |
|---|---|---|---|---|---|
| GET | /api/progress/:chapterId | yes | read | — | 200 `{ pageIndex, completed }` |
| PUT | /api/progress/:chapterId | yes | progress | `{ pageIndex, completed? }` | 200 `{ ok:true }` |
| GET | /api/progress/continue | yes | read | — | 200 `{ items: [{ series, chapter, pageIndex }] }` |

### Settings / storage / health
| method | path | auth | RL | request | response |
|---|---|---|---|---|---|
| GET | /api/settings | yes | read | — | 200 `{ settings }` |
| PATCH | /api/settings | yes | write | partial settings (Zod) | 200 `{ settings }` |
| GET | /api/storage | yes | read | — | 200 `{ usedBytes, limitBytes, seriesCount, chapterCount }` |
| GET | /api/health | no | read | — | 200/503 `{ mongo, redis, r2 }` |

---

## 9. Auth design (token lifecycle)

- **Signup gating (invite-only)**: when `SIGNUPS_OPEN=false` (default), signup requires a valid,
  unexpired `inviteToken` whose email matches the submitted email. When `SIGNUPS_OPEN=true`, signup
  is open. **Bootstrap**: if no users exist (or the email equals `BOOTSTRAP_ADMIN_EMAIL`), the account
  is created as `role=admin` with no invite required, so the instance owner can get in first. Series
  invites (kind=series) also serve as app invites; accepting one after signup grants the membership.
- **Passwords**: argon2id (`argon2` lib, memoryCost/timeCost tuned for ~250 ms). Min length 12.
- **Access token**: JWT HS256 via `jose`, TTL `JWT_ACCESS_TTL` (900 s). Claims
  `{ sub: userId, sid: sessionId, tv: tokenVersion, jti, iat, exp, iss: APP_URL, aud: "shelf" }`.
- **Refresh token**: random 32-byte opaque token (base64url). Stored only as sha-256 hash in `Session`.
  Delivered in an httpOnly cookie scoped to `path=/api/auth`, TTL `JWT_REFRESH_TTL` (30 d).
- **Cookies**: both httpOnly, `Secure` (in prod), `SameSite=Lax`. Access cookie `path=/`.
- **Rotation + reuse detection**: refresh rotates every call. The old session is marked
  `revokedAt` + `replacedBy`. If a refresh token that is already `revokedAt` is presented, the
  entire `familyId` is revoked (compromise assumed) and the client is forced to re-login.
- **Revocation checks (all must pass)**: (1) signature + exp, (2) session exists and not revoked,
  (3) `tv` claim === `User.tokenVersion`, (4) `jti` not in Redis denylist.
- **Logout**: revoke current session, add access `jti` to denylist (TTL = remaining exp).
- **Logout-all**: revoke all sessions for user, bump `tokenVersion` (invalidates all outstanding access tokens).
- **Change password**: verify current, set new hash, revoke all sessions except current, bump `tokenVersion`,
  reissue current session tokens.
- **Account lockout**: 5 failed logins / 15 min per IP and per email → exponential backoff (Redis), returns 429.
- **proxy.ts (edge)**: fast optimistic check of access token signature/exp only (jose, Edge-safe) to
  gate protected routes and redirect to `/login`. Full revocation checks happen in `requireUser()`
  in node route handlers (needs Mongo/Redis).
- **Client**: `fetchWithAuth` retries once through `/api/auth/refresh` on a 401, then redirects to login.

---

## 10. Security checklist (tracked; ✅ when done)

- [ ] Membership check on every content resource (read: owner|reader; write: owner); non-member → 404 not 403.
- [ ] Invite tokens: opaque, hashed at rest, single-use, email-bound, expiring; timing-safe lookup.
- [ ] Zod validation on every body, query, and route param (ObjectId regex); `.strict()` rejects unknown keys.
- [ ] `mongoose.set("sanitizeFilter", true)`; never spread raw request objects into queries.
- [ ] CSRF: SameSite=Lax cookies + Origin/Referer allowlist on all state-changing methods. (Decision: header check over double-submit token, since cookies are httpOnly and SPA is same-origin.)
- [ ] Security headers (next.config + proxy): strict CSP (img-src/connect-src allow R2 host + self; `worker-src 'self'`, `manifest-src 'self'` for the PWA; PDF.js/epub.js needs handled), HSTS, X-Content-Type-Options=nosniff, Referrer-Policy=strict-origin-when-cross-origin, frame-ancestors 'none', Permissions-Policy minimal. Service worker + manifest served same-origin.
- [ ] Archive safety: MAX_ENTRIES, MAX_UNCOMPRESSED_BYTES, compression-ratio cap; zip-slip (reject `..`, absolute, null bytes); reject password-protected archives; every image decoded by sharp before acceptance; temp cleaned in `finally`.
- [ ] Upload safety: presign binds key + ContentType + ContentLength; filename sanitized; HeadObject size verify at complete; quota at presign and complete.
- [ ] `import "server-only"` on server modules; never log tokens/passwords/presigned URLs.
- [ ] pino structured logging with request ids; client errors carry no stack traces.
- [ ] Timing-safe token comparisons; generic auth error messages.
- [ ] `npm audit` in final phase.

---

## 11. Caching strategy and invalidation

- **Cache-aside** for series list, series detail, chapter list, page URL list, continue-reading, storage.
- **Version-counter invalidation**: instead of deleting keys, bump counters — the global
  `ver:series:{seriesId}` and each affected member's `ver:list`; keys embed the counter so stale
  entries expire naturally by TTL and are never read. No `KEYS`, no scans.
- **Invalidation rules**:
  - Series create → bump owner's `ver:list`. Series update/delete → bump `ver:series:{id}` + each member's `ver:list`.
  - Chapter create/update/delete/status-change, page insert (worker done) → bump `ver:series:{seriesId}` + each member's `ver:list`.
  - Membership change (invite accepted / member removed) → bump that user's `ver:list` (and `memberCount` denorm).
  - Page-URL and detail/chapter caches embed `ver:series:{seriesId}`, so they drop for all members at once.
  - Progress write → update `progress:{chapterId}` + bump that user's own `ver:list` (affects their continue-reading order only).
  - Storage change (worker done / delete) → delete owner's `storage` key.
- **Graceful degradation**: any Redis read error → log + treat as miss → read Mongo. Writes to cache are best-effort.

---

## 12. UI / UX spec

Design language: **simple, clean, calm, dark-first**, content-forward, premium e-reader feel.
Restraint over decoration: generous whitespace, one accent color, few font sizes, minimal borders
(prefer subtle surfaces over lines), no gradients or shadows beyond a soft elevation. Tailwind v4
tokens + shadcn/ui. `next-themes` for light/dark/system. Mobile-first, fully responsive. Skeleton
loaders, optimistic updates (TanStack Query), `sonner` toasts, thoughtful empty/error states.
Accessible: keyboard navigable, visible focus rings, aria labels, respects `prefers-reduced-motion`.
**No em dashes in UI copy.**

**Color palette (fixed).** Four colors only; everything derives from these.
| token | hex | role |
|---|---|---|
| ink / bg-dark | `#222831` | app background (dark), darkest surface |
| surface | `#31363F` | cards, bars, elevated surfaces (dark) |
| accent | `#76ABAE` | single accent: primary actions, links, focus ring, progress, active state |
| paper / fg-light | `#EEEEEE` | primary text on dark; app background in light mode |

Tailwind v4 `@theme` tokens (CSS variables), mapped for both modes:
- **Dark (default)**: `--background:#222831`, `--surface:#31363F`, `--foreground:#EEEEEE`,
  `--accent:#76ABAE`, muted text = `#EEEEEE` at ~70% opacity, borders = `#EEEEEE` at ~8-12%.
- **Light**: `--background:#EEEEEE`, `--surface:#ffffff`/`#EEEEEE`-tinted, `--foreground:#222831`,
  `--accent:#76ABAE` (darkened slightly for AA contrast on light), borders = `#222831` at ~10%.
- Accent-on-dark and text pairings are checked for **WCAG AA** contrast; `#76ABAE` is used for large
  text/UI accents and interactive states, not small body text on `#EEEEEE`.
- The reader uses a pure-black option too (deep dark for OLED) as a reader-only theme; app chrome stays on the palette.

- **/** (landing): value prop, sign in / create account CTAs; signed-in users redirected to `/library`.
- **/login**, **/signup**: minimal forms, inline validation, generic auth errors, loading states.
- **/library**: "Continue reading" horizontal row; responsive cover grid; search box (debounced);
  sort (recent, title, recently added); floating Upload button; storage usage bar. Skeletons + empty state.
- **/series/[id]**: cover, editable metadata (title/description/tags) with optimistic save; chapter list
  showing read state + per-chapter progress bar; bulk "mark read"; retry failed chapters; delete series (confirm).
  **Owners** see a Share panel: current members with roles, pending invites, remove member, and "Invite
  by email" that produces a copyable invite link (the invitee must open it and click accept, even if they
  already have an account). **Readers** see a read-only view (no edit/upload/delete/share controls).
- **/upload** (owners only): drag-and-drop multiple files and folders; per-file cards with upload progress
  (incl. multipart part progress); after upload, live processing progress via SSE; assign to a series you
  own or create new; edit chapter number/title/volume before submit; cancel/abort support.
  For PDF/EPUB files, a **reader-mode chooser** offers only the possible options: "Read as pages
  (optimized images)" or "Keep original document (native reader)". Other formats default to pages.
- **/accept/[token]**: invite landing. Shows who invited you and to what; if signed in with the matching
  email, one-click accept; otherwise routes to signup with the email prefilled and token attached.
- **/read/[chapterId]**: dispatches by `renderMode` — the image reader (below) or the native document
  reader (PDF.js with text layer + page nav; epub.js with reflow, font size, and chapter TOC). Both
  save progress the same way (page index for images/PDF; CFI-derived percentage for EPUB).
- **/settings**: reading defaults (mode, direction, fit, preload count), theme; active sessions list with
  revoke; change password; storage usage. Admins additionally get an "Invite people" control (app invites).

**PWA / installable app**
- Web App Manifest (`app/manifest.ts`): `name`, `short_name: "Shelf"`, `start_url: "/library"`,
  `display: "standalone"`, `theme_color`/`background_color` (dark-first), `orientation: "any"`,
  icons at 192 and 512 plus a maskable 512, and an `apple-touch-icon`.
- Service worker (`public/sw.js`, registered client-side after load): precache the app shell + static
  assets; **network-first** for navigations with an offline fallback page; **stale-while-revalidate**
  for `/_next/static`, fonts, and icons. It **never caches** authenticated `/api/*` responses or
  presigned R2 content (avoids cross-user leakage and stale/expired URLs). Versioned cache name;
  old caches purged on `activate`. `skipWaiting` + `clients.claim`.
- **Install button** in the library header and in Settings: an `InstallPrompt` provider captures
  `beforeinstallprompt` (preventing the mini-infobar), stores the deferred event, and shows an
  "Install app" button that calls `prompt()`. The button hides when already installed
  (`display-mode: standalone` or `appinstalled`). On iOS/Safari (no `beforeinstallprompt`), show a
  short "Add to Home Screen" instruction instead. All copy avoids em dashes.

**Image reader**
- Modes: vertical scroll (webtoon), single page, double page (spreads shown alone; optional cover offset).
- RTL (default) / LTR toggle; fit width/height/original; pinch + ctrl+scroll zoom in paged mode.
- Navigation: arrow keys, space, A/D, tap zones (left third / right third / center toggles UI), swipe,
  page slider with thumbnail preview.
- Auto-hiding top/bottom bars. Reserve layout from stored dimensions (no layout shift).
- Preload next N pages; IntersectionObserver lazy load in scroll mode; `srcset` picks 800 vs 1600.
- Save progress: 1.5 s debounce + on `visibilitychange`. Resume from last page. Mark completed at end.
- End-of-chapter screen: "Next chapter" and "Back to series".
- Refresh presigned URLs before expiry; retry an image once on 403.

---

## 12a. SEO

The library is private (invite-only), so SEO targets the **public shell** while keeping all private
content out of search indexes.
- **Metadata**: App Router Metadata API in `layout.tsx` + per-route `generateMetadata`. Title template
  (`%s · Shelf`), description, canonical URLs, `metadataBase` from `APP_URL`, OpenGraph + Twitter cards,
  `theme-color` (matches palette), and a generated OG image (`opengraph-image.tsx`) for the landing page.
- **Indexing policy**: `robots.ts` allows `/`, `/login`, `/signup` and **disallows** `/library`,
  `/series`, `/read`, `/upload`, `/settings`, `/accept`, `/api`. Authenticated/app routes set
  `robots: { index: false, follow: false }` in their metadata as defense in depth.
- **`sitemap.ts`**: only the public routes.
- **Structured data**: minimal `WebApplication` JSON-LD on the landing page. No content JSON-LD (private).
- **Fundamentals**: one `<h1>` per page, semantic landmarks, descriptive `alt` text, `lang` on `<html>`,
  meaningful link text, `manifest` linked, favicon + apple-touch icons. Clean, stable URLs.

## 12b. Performance

Targets: **Lighthouse Performance / SEO / Best-Practices 90+** on landing, library, and reader; good
Core Web Vitals (LCP, CLS ~0, INP low).
- **Rendering**: React Server Components by default; client components only where interactivity is needed
  (reader, upload, forms, install prompt). Stream with Suspense + skeletons. React Compiler is on
  (auto-memoization) so avoid manual memo noise.
- **Data**: TanStack Query caching + Redis cache-aside on the server (see §6/§11) so repeat views are cheap.
  Cursor pagination for the library grid; avoid over-fetching (lean DTOs, projections in services).
- **Code splitting**: dynamically import the heavy readers (`pdfjs-dist`, `epubjs`) and the upload
  drag-and-drop only on their routes. Keep the initial route JS small; tree-shake `lucide-react` (per-icon imports).
- **Images**: covers/thumbs via `next/image` with correct `sizes`; reader uses `srcset` (800/1600) and
  native lazy-loading + IntersectionObserver; reserve dimensions to keep **CLS ~0**; preload the next N pages.
  WebP q82 variants keep payloads small.
- **Fonts**: `next/font` (self-hosted, `display: swap`, subset) to avoid layout shift and third-party calls.
- **Network**: HTTP caching headers on static + presigned GETs (`ResponseCacheControl`); SW precache of the
  app shell (§12 PWA); `Accept-Encoding` compression at the reverse proxy.
- **Budgets**: track first-load JS per route; fail the a11y/perf pass in Phase 8 if a route regresses badly.
- **Server**: connection singletons (Mongo/Redis/R2) reused across invocations; indexed queries only
  (every access path has a supporting index per §5); no N+1 (batch page/member lookups).

---

## 13. Phases

Each phase ends with lint + typecheck + tests green, a manual test guide, and a STOP for review.
Never leave the build broken between phases.

### Phase 1 — Foundations — DONE
- [x] Add deps (app + tooling); configure prettier, vitest, path aliases.
- [x] `lib/env.ts` Zod env validation (fail fast), `.env.example`.
- [x] `lib/logger.ts` (pino + request id helper).
- [x] `lib/db.ts` (mongoose singleton, sanitizeFilter), `lib/redis.ts` (ioredis), `lib/r2.ts` (S3 client + presign helpers).
- [x] `lib/errors.ts` (ApiError + `withRoute` wrapper), `lib/http.ts` (json, validate, origin check).
- [x] Security headers in `next.config.ts` + skeleton `proxy.ts`.
- [x] All Mongoose models with indexes.
- [x] `GET /api/health`.
- Deliverables: app boots, `/api/health` reports mongo/redis/r2, env fails fast when misconfigured.
- Acceptance: typecheck/lint/tests pass; health returns 200 with all three checks when services up.
- Result: typecheck + eslint + prettier clean; 8/8 unit tests (env validation) pass.

### Phase 2 — Auth (with invite-gated signup)
- [ ] `lib/auth/*` (password, tokens, session, cookies, requireUser, denylist, lockout).
- [ ] `Invite` model + service; invite-gated signup (`SIGNUPS_OPEN` flag; bootstrap admin); mint app invite (admin); invite preview + accept routes.
- [ ] Auth routes (signup, login, refresh w/ rotation+reuse, logout, logout-all, me, change-password, sessions list/delete).
- [ ] `proxy.ts` optimistic gate; rate limiting on auth routes (fail closed).
- [ ] Auth pages (/login, /signup w/ invite token, /accept/[token]), providers (theme + query client + `InstallPrompt`), `fetchWithAuth`.
- [ ] PWA manifest (`app/manifest.ts`) + generated icons (192/512/maskable/apple-touch) + theme-color meta.
- [ ] Design tokens: wire the fixed palette (§12) into Tailwind v4 `@theme` for light/dark; base UI primitives.
- [ ] SEO base: `metadataBase`/title template, `robots.ts`, `sitemap.ts`, landing `opengraph-image.tsx`, per-route noindex on app routes.
- [ ] Unit tests: jwt sign/verify, rotation, reuse detection, lockout, password hashing, invite token hash/verify/expiry.
- Deliverables: bootstrap admin signs up; invited user signs up via token; full login→refresh→logout cycle; protected route redirect.
- Acceptance: signup blocked without a valid invite when SIGNUPS_OPEN=false; reused refresh token revokes family; logout invalidates access immediately; 429 on brute force.

### Phase 3 — Upload (API + UI)
- [ ] Presign (single + multipart), parts, complete (HeadObject verify), abort; quota + concurrency guards; owner-only target series.
- [ ] `upload.service.ts`, Upload model wiring (incl. `renderMode`), rate limit (upload tier).
- [ ] Upload UI: drag-drop, per-file cards, progress, series assign/create, chapter meta edit, PDF/EPUB reader-mode chooser, abort.
- Deliverables: file lands in R2 `uploads/raw/...`; Chapter created `queued` with chosen renderMode; job enqueued.
- Acceptance: >100 MB uses multipart; oversize/over-quota rejected; abort aborts multipart; renderMode=document rejected for non PDF/EPUB.

### Phase 4 — Worker + ingestion (ZIP first)
- [ ] BullMQ setup (`worker/`), graceful shutdown, Zod job payloads, concurrency from env.
- [ ] ZIP adapter (yauzl) with safety limits; clean (junk filter, natural sort, multi-folder split, ch/vol parse).
- [ ] sharp pipeline (rotate, strip, webp 1600/800, thumb, dims, isSpread); R2 upload; DB writes; cache invalidation; raw cleanup.
- [ ] SSE `GET /api/jobs/:id/stream` via QueueEvents (ownership check).
- [ ] Unit tests: detect, naming/sort, junk filter, ch/vol parse, path sanitize; zipbomb + zip-slip fixtures.
- Deliverables: upload a CBZ → processed → pages in R2 → live SSE progress.
- Acceptance: zip bomb + `../` rejected safely; pages 1..120 in numeric order.

### Phase 5 — Library APIs + sharing + pages
- [ ] `SeriesMember` model + `access.ts` (assertSeriesRead/Owner); membership-scoped series + chapter services with caching + version-counter invalidation.
- [ ] Series routes (list via memberships/search/sort/paginate, CRUD), chapters route, delete via cleanup queue.
- [ ] Sharing routes: members list, pending invites list, series invite (mint link; always pending until accepted), remove member; explicit accept path (existing users included).
- [ ] Library page (continue row, grid, search, sort, storage bar), series detail page with Share panel (owner) and read-only view (reader).
- Deliverables: library renders real data (owned + shared); owner shares a series; invited reader sees it; edits invalidate cache; delete enqueues cleanup.
- Acceptance: repeat loads served from Redis; cache invalidated for all members after edits; non-member gets 404; reader cannot mutate.

### Phase 6 — Image reader + progress + settings
- [ ] `GET /api/chapters/:id/pages` (presigned + cached), progress GET/PUT + continue, settings GET/PATCH.
- [ ] Image reader (all modes, nav, zoom, preloading, URL refresh, retry-on-403), progress sync, end-of-chapter.
- [ ] Settings page (defaults, theme, sessions, change password, storage).
- Deliverables: read an images chapter end to end; progress resumes cross-device.
- Acceptance: no layout shift (reserved dims); progress set on one device resumes on another; URL refresh works.

### Phase 7 — More formats + native document reader
- [ ] RAR (node-unrar-js), 7z (node-7z + 7zip-bin), image-based EPUB → images pipeline; multi-folder → multiple chapters; extended ch/vol parsing.
- [ ] PDF: images mode via `pdfjs-dist` + `@napi-rs/canvas`; document mode keeps original + generates cover.
- [ ] EPUB: images mode (extract spine images) + document mode keeps original.
- [ ] `renderMode=document` pipeline branch (validate, copy original, cover) + `GET /api/chapters/:id/document`.
- [ ] Native readers: PDF.js viewer (text layer, page nav, progress) and epub.js reader (reflow, font size, TOC, CFI progress).
- [ ] Tests per adapter with tiny fixtures; RAR-renamed-to-.cbz detection.
- Deliverables: all five source formats ingest; PDFs/EPUBs readable as pages OR as native documents per the uploader's choice.
- Acceptance: RAR renamed .cbz detected by magic bytes; EPUB spine order preserved; PDF pages rasterized in order; document-mode PDF/EPUB open in the native reader with working progress.

### Phase 8 — Hardening + ops
- [ ] Full rate-limit coverage (all tiers), security checklist review, CSP finalize (allow R2 host + PDF.js/epub.js needs).
- [ ] `cleanup` + `maintenance` (repeatable) processors; storage recompute; purge expired uploads + expired invites; abort stale multipart.
- [ ] PWA: `public/sw.js` (safe caching per §12, offline fallback page, versioned caches) + register on load; wire the **Install button** (library header + Settings) with iOS "Add to Home Screen" fallback; verify Lighthouse "installable".
- [ ] SEO audit: metadata/OG/canonical on every route, robots + sitemap correct, private routes noindexed, valid JSON-LD on landing.
- [ ] Performance pass: dynamic-import heavy readers, per-icon imports, `next/image` sizes, first-load JS budget check, confirm CLS ~0 and good LCP/INP on landing/library/reader.
- [ ] Accessibility pass (Lighthouse 90+ on library + reader).
- [ ] Playwright: signup (via invite), login, upload small CBZ, read, progress persists after reload; share a series and read as invited user.
- [ ] `Dockerfile.worker`, `docker-compose.yml` (worker, redis, optional app), README (R2 bucket/CORS/lifecycle, Redis, running worker, deploy on Oracle VM, ARM/x64 notes, invite bootstrap), `npm audit`.
- Deliverables: production-ready worker image + compose; complete README.
- Acceptance: all acceptance criteria in the task met; app is installable (manifest + SW, Install button works, iOS fallback shown); lint/typecheck/unit/e2e green; **Lighthouse Performance, Accessibility, Best-Practices, and SEO all 90+** on landing, library, and reader.

---

## 14. Decisions log

- **D1**: Middleware file is `proxy.ts` (Next 16 renamed Middleware → Proxy). Same semantics; edge-safe optimistic auth only.
- **D2**: Route handler params are async (`await ctx.params`) and typed with the global `RouteContext<...>` helper (Next 16 typegen).
- **D3**: Refresh token is an opaque random token (hashed in Mongo), not a JWT. Simpler revocation; only a hash is stored.
- **D4**: Progress uses write-through (Redis + debounced Mongo upsert) rather than a background flush queue, for correct cross-device resume with bounded writes.
- **D5**: Cache invalidation uses version counters embedded in keys — a global `ver:series:{id}` plus a per-user `ver:list` (bumped for each member on content changes); never `KEYS`/scan.
- **D6**: CSRF handled via SameSite=Lax + Origin/Referer allowlist (not double-submit token), since auth cookies are httpOnly and the SPA is same-origin.
- **D7**: PDF rendering via `pdfjs-dist` + `@napi-rs/canvas`; revisit `pdf-to-img` in Phase 7 if native canvas is problematic on the VPS.
- **D8**: Rate limiting fails **closed on auth routes**, **open elsewhere**.
- **D9**: `zod` and `sharp` already resolve in node_modules transitively; they will be added as explicit direct dependencies.
- **D10** (overrides task non-goal "strictly private per user"): content supports **invite-based
  per-series sharing**. Access is via `SeriesMember` (owner|reader), not `ownerId` equality. Still no
  public content and no discovery. Series/Chapter/Page use `ownerId`; Progress/Upload/Session use `userId`.
- **D11**: Instance is **invite-only** (`SIGNUPS_OPEN=false` default). First user or `BOOTSTRAP_ADMIN_EMAIL`
  becomes admin without an invite. Invites are opaque, hashed, email-bound, single-use, expiring (`INVITE_TTL`).
- **D11a**: **Every invite requires an explicit accept click**, including invitees who already have an
  account (no silent auto-add). A series invite always creates a pending `Invite`; membership is granted
  only when the invitee opens `/accept/[token]` and confirms (signing in or signing up first if needed).
- **D12**: PDF/EPUB get a **per-file reader-mode choice**: "images" (rasterize/extract to WebP, image
  reader) or "document" (keep original, native reader — PDF.js / epub.js). The UI offers only options
  possible for that file. Adds `Chapter.renderMode/documentKey/documentFormat` and `chapters/:id/document`.
- **D13**: **No Bull Board** (dropped). Queue health covered by `/api/health` + logs + maintenance jobs.
- **D14**: **Deploy target**: self-host the Next.js app + worker + Redis on the Oracle Cloud VM
  (2 OCPU / 12 GB) alongside an existing app. So: cookie `Secure=true` (HTTPS via the machine's reverse
  proxy), CSP `connect-src`/`img-src` = self + R2 host, `docker-compose` exposes configurable ports to
  avoid clashing with the running app, and `Dockerfile.worker` is arch-aware (Oracle Ampere is ARM64;
  `sharp`/`@napi-rs/canvas`/`7zip-bin` ship ARM64 builds — verify at image build).
- **D15**: EPUB and PDF are first-class for novels/books too, not just manga (see D12).
- **D16**: The app is an installable **PWA** via a hand-rolled `app/manifest.ts` + minimal `public/sw.js`
  (no next-pwa/serwist bundler plugin, to stay safe on this modified Next 16 build). A custom
  `InstallPrompt` provider captures `beforeinstallprompt` and drives an **Install button** in the library
  header and Settings, with an iOS "Add to Home Screen" fallback. The SW never caches authenticated
  `/api/*` or presigned R2 responses (no cross-user leakage, no stale presigned URLs). Manifest + icons
  land in Phase 2; the SW and functional Install button land in Phase 8.
- **D17**: Fixed 4-color palette `#222831 / #31363F / #76ABAE / #EEEEEE` (single accent = `#76ABAE`),
  wired as Tailwind v4 `@theme` tokens for light + dark, chosen for a simple, clean, dark-first UI (§12).
- **D18**: SEO and performance are explicit acceptance gates (§12a/§12b): public shell is indexable and
  metadata-complete, all private/app routes are noindexed, and Lighthouse Perf/A11y/Best-Practices/SEO
  must be 90+ on landing, library, and reader.
- **D19** (Phase 1): `import "server-only"` is applied to app-only server modules (later phases: auth
  cookies, next/headers users), NOT to the worker-shared infra (`env`, `logger`, `db`, `redis`, `r2`).
  Reason: `server-only` throws outside the React Server condition, which the plain-Node worker and tests
  do not set. Those infra modules pull in Node-only deps (mongoose/ioredis/aws-sdk) so they cannot land
  in a client bundle anyway.
- **D20** (Phase 1): `@types/node` bumped `^20 → ^22` to match the Node 22 runtime and satisfy vitest 5's
  peer requirement. `vitest.config` uses the `.mts` extension (ESM) to avoid the Vite CJS-loader warning.

## 15. Environment variables (additions to the task's list)

Validated in `lib/env.ts` (Zod, fail fast) alongside the task-provided vars:
```
SIGNUPS_OPEN=false            # invite-only when false
INVITE_TTL=604800             # 7 days, seconds
BOOTSTRAP_ADMIN_EMAIL=        # optional; this email becomes admin on signup without an invite
```
Deploy note (D14): `APP_PORT` / `REDIS_PORT` (or compose port mappings) are configurable to coexist
with the app already running on the VM.

## 16. Open questions

All Phase-0 questions resolved (see Decisions D10–D15). None currently blocking Phase 1.
New items will be logged here as they arise.
