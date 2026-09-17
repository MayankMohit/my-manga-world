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
- Direct-to-R2 uploads via presigned URLs (single PUT and multipart).
- Background ingestion pipeline with live progress over SSE.
- Private per-user library: series, chapters, pages, progress, settings, storage quota.
- A premium e-reader: webtoon (vertical), single page, double page; RTL/LTR; fit modes; zoom; preloading; progress sync.
- Redis caching, rate limiting, token revocation; graceful degradation.
- Dockerized worker + Redis + optional app for a VPS.

**Non-goals (hard constraints)**
- No public sharing. No discovery of other users' content. Libraries are strictly private per user.
- No scraping or fetching content from third-party sites. Uploads only.
- No payment, no multi-tenant org features, no social features.

**Definition of "private".** Every persisted resource carries a `userId`. Every query
is scoped by `userId` through service functions (never ad hoc in routes). Cross-user
access returns **404**, never 403, to avoid leaking existence.

---

## 2. Final tech stack (exact package names)

**Runtime / framework (already installed)**
- `next@16.3.5` (App Router), `react@19.2.8`, `react-dom@19.2.8`, `typescript@^5` (strict)
- `tailwindcss@^4`, `@tailwindcss/postcss@^4`

**To add — app + shared**
- UI: `shadcn` (CLI-generated components), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tailwindcss-animate`, `next-themes`, `sonner` (toasts)
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
│  │  ├─ signup/page.tsx
│  │  ├─ (app)/library/page.tsx
│  │  ├─ (app)/series/[id]/page.tsx
│  │  ├─ (app)/upload/page.tsx
│  │  ├─ (app)/read/[chapterId]/page.tsx
│  │  ├─ (app)/settings/page.tsx
│  │  ├─ layout.tsx, globals.css, providers.tsx
│  │  └─ api/
│  │     ├─ auth/{signup,login,refresh,logout,logout-all,me,change-password}/route.ts
│  │     ├─ auth/sessions/route.ts, auth/sessions/[id]/route.ts
│  │     ├─ uploads/presign/route.ts
│  │     ├─ uploads/[id]/{parts,complete,abort}/route.ts
│  │     ├─ jobs/[id]/route.ts, jobs/[id]/stream/route.ts
│  │     ├─ series/route.ts, series/[id]/route.ts, series/[id]/chapters/route.ts
│  │     ├─ chapters/[id]/route.ts, chapters/[id]/pages/route.ts, chapters/[id]/retry/route.ts
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
│  ├─ services/               # userId-scoped business logic
│  │  ├─ series.service.ts, chapter.service.ts, page.service.ts
│  │  ├─ progress.service.ts, upload.service.ts, user.service.ts, storage.service.ts
│  ├─ models/                 # Mongoose models
│  │  ├─ User.ts, Session.ts, Series.ts, Chapter.ts, Page.ts, Progress.ts, Upload.ts
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

Common: `_id: ObjectId`. All content models carry `userId: ObjectId` (indexed).
`mongoose.set("sanitizeFilter", true)` globally.

### User
| field | type | notes |
|---|---|---|
| email | string | unique, lowercased, trimmed |
| passwordHash | string | argon2id |
| name | string | optional display name |
| tokenVersion | number | default 0; bumped on logout-all / password change |
| storageUsedBytes | number | default 0 |
| role | "user" \| "admin" | default "user" (admin gates Bull Board) |
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

### Series
| field | type | notes |
|---|---|---|
| userId | ObjectId | |
| title | string | |
| sortTitle | string | lowercased, article-stripped for sorting |
| coverKey | string? | R2 key |
| description | string? | |
| tags | string[] | |
| chapterCount | number | denormalized |
| lastReadAt | Date? | |

Indexes: `{ userId: 1, sortTitle: 1 }`, `{ userId: 1, lastReadAt: -1 }`, text-ish search via regex on title (see caching notes).

### Chapter
| field | type | notes |
|---|---|---|
| userId | ObjectId | |
| seriesId | ObjectId | ref Series |
| number | number (float) | supports 12.5 |
| title | string? | |
| volume | number? | |
| pageCount | number | default 0 |
| status | "queued"\|"processing"\|"ready"\|"failed" | |
| error | string? | human-readable |
| sourceFormat | "zip"\|"rar"\|"7z"\|"pdf"\|"epub"\|"images" | |
| sizeBytes | number | raw upload size |
| jobId | string? | BullMQ job id (= uploadId) |

Indexes: `{ userId: 1, seriesId: 1, number: 1 }`, `{ userId: 1, status: 1 }`, `{ jobId: 1 }`.

### Page
| field | type | notes |
|---|---|---|
| chapterId | ObjectId | |
| userId | ObjectId | |
| index | number | 0-based order |
| key | string | 1600w webp R2 key |
| key800 | string | 800w webp key |
| thumbKey | string | 240px thumb key |
| width | number | of 1600 variant (intrinsic) |
| height | number | |
| isSpread | boolean | width > height * 1.1 |
| bytes | number | sum of variant bytes |

Indexes: `{ chapterId: 1, index: 1 }` unique, `{ userId: 1 }`.

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
| seriesId | ObjectId? | target series |
| chapterMeta | subdoc? | proposed `{ number, title, volume }` |
| expiresAt | Date | TTL index (2 days) for abandoned uploads |

Indexes: `{ userId: 1 }`, `{ rawKey: 1 }`, TTL `{ expiresAt: 1 }`.

---

## 6. Redis key design

Prefix everything with `shelf:v1:`. Separate logical namespaces below.

**Version counters (invalidation without KEYS/scans)**
- `shelf:v1:{userId}:ver:series` — bumped on any series/chapter create/update/delete
- `shelf:v1:{userId}:ver:series:{seriesId}` — bumped on that series' chapter/page changes
- Cache keys embed the current counter value so stale entries are simply never read.

**Cache-aside (TTLs)**
| key | contents | TTL |
|---|---|---|
| `shelf:v1:{userId}:series:list:{ver}:{hash(query)}` | paginated series list DTO | 120 s |
| `shelf:v1:{userId}:series:detail:{ver}:{seriesId}` | series detail DTO | 120 s |
| `shelf:v1:{userId}:series:{seriesId}:chapters:{sver}` | chapter list DTO | 120 s |
| `shelf:v1:{userId}:chapter:{chapterId}:pages:{sver}` | presigned page URL list + dims | PRESIGN_DOWNLOAD_TTL − 300 s |
| `shelf:v1:{userId}:continue:{ver}` | continue-reading list DTO | 60 s |
| `shelf:v1:{userId}:storage` | storage usage snapshot | 60 s |

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

```
uploads/raw/{userId}/{uploadId}/{sanitizedFileName}
library/{userId}/{seriesId}/{chapterId}/{index:04}-1600.webp
library/{userId}/{seriesId}/{chapterId}/{index:04}-800.webp
library/{userId}/{seriesId}/{chapterId}/thumbs/{index:04}.webp
library/{userId}/{seriesId}/cover.webp
```

- Bucket is private; no public access. CORS allows `PUT`/`GET` from `APP_URL` only, exposes `ETag` (README).
- Lifecycle rule (README): delete `uploads/raw/` objects older than 2 days.
- Deletes never remove R2 objects inline; a `cleanup` job deletes prefixes.

---

## 8. API contract

Conventions: all non-auth routes require a valid access token (via cookie).
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
| POST | /api/auth/signup | no | auth-strict | `{ email, password(min12), name? }` | 201 `{ user }` + sets cookies |
| POST | /api/auth/login | no | auth-strict | `{ email, password }` | 200 `{ user }` + cookies (generic error on fail) |
| POST | /api/auth/refresh | cookie | auth-refresh | (refresh cookie) | 200 `{ ok:true }` + rotated cookies |
| POST | /api/auth/logout | yes | write | — | 204, revoke session + denylist jti |
| POST | /api/auth/logout-all | yes | write | — | 204, revoke all + bump tokenVersion |
| GET | /api/auth/me | yes | read | — | 200 `{ user }` |
| POST | /api/auth/change-password | yes | auth-strict | `{ currentPassword, newPassword }` | 204, revoke other sessions |
| GET | /api/auth/sessions | yes | read | — | 200 `{ sessions: [...] }` |
| DELETE | /api/auth/sessions/:id | yes | write | param id | 204 |

### Uploads
| method | path | auth | RL | request | response |
|---|---|---|---|---|---|
| POST | /api/uploads/presign | yes | upload | `{ fileName, size, contentType, multipart?:bool, seriesId?, newSeriesTitle?, chapterMeta? }` | 200 single: `{ uploadId, url, key }`; multipart: `{ uploadId, key, partSize, partCount }` |
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
| GET | /api/chapters/:id/pages | yes | read | — | 200 `{ pages: [{ index, url, url800, thumbUrl, width, height, isSpread }], expiresAt }` |
| POST | /api/chapters/:id/retry | yes | write | — | 202 `{ jobId }` (only if status=failed) |

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

- [ ] Ownership check on every resource; cross-user → 404 not 403.
- [ ] Zod validation on every body, query, and route param (ObjectId regex); `.strict()` rejects unknown keys.
- [ ] `mongoose.set("sanitizeFilter", true)`; never spread raw request objects into queries.
- [ ] CSRF: SameSite=Lax cookies + Origin/Referer allowlist on all state-changing methods. (Decision: header check over double-submit token, since cookies are httpOnly and SPA is same-origin.)
- [ ] Security headers (next.config + proxy): strict CSP (img-src/connect-src allow R2 host + self), HSTS, X-Content-Type-Options=nosniff, Referrer-Policy=strict-origin-when-cross-origin, frame-ancestors 'none', Permissions-Policy minimal.
- [ ] Archive safety: MAX_ENTRIES, MAX_UNCOMPRESSED_BYTES, compression-ratio cap; zip-slip (reject `..`, absolute, null bytes); reject password-protected archives; every image decoded by sharp before acceptance; temp cleaned in `finally`.
- [ ] Upload safety: presign binds key + ContentType + ContentLength; filename sanitized; HeadObject size verify at complete; quota at presign and complete.
- [ ] `import "server-only"` on server modules; never log tokens/passwords/presigned URLs.
- [ ] pino structured logging with request ids; client errors carry no stack traces.
- [ ] Timing-safe token comparisons; generic auth error messages.
- [ ] `npm audit` in final phase.

---

## 11. Caching strategy and invalidation

- **Cache-aside** for series list, series detail, chapter list, page URL list, continue-reading, storage.
- **Version-counter invalidation**: instead of deleting keys, bump `ver:series` (user-wide) and
  `ver:series:{seriesId}` (series-wide) counters; keys embed the counter so stale entries expire
  naturally by TTL and are never read. No `KEYS`, no scans.
- **Invalidation rules**:
  - Series create/update/delete → bump `ver:series`.
  - Chapter create/update/delete/status-change, page insert (worker done) → bump `ver:series` and `ver:series:{seriesId}`.
  - Page-URL cache is keyed by series version, so it drops when the chapter set changes; it also
    naturally expires before the presigned URLs do.
  - Progress write → update `progress:{chapterId}` + bump `ver:series` (affects continue-reading order).
  - Storage change (worker done / delete) → delete `storage` key.
- **Graceful degradation**: any Redis read error → log + treat as miss → read Mongo. Writes to cache are best-effort.

---

## 12. UI / UX spec

Design language: calm, dark-first, content-forward, premium e-reader feel. Tailwind v4 tokens +
shadcn/ui. `next-themes` for light/dark/system. Mobile-first, fully responsive. Skeleton loaders,
optimistic updates (TanStack Query), `sonner` toasts, thoughtful empty/error states. Accessible:
keyboard navigable, visible focus rings, aria labels, respects `prefers-reduced-motion`.
**No em dashes in UI copy.**

- **/** (landing): value prop, sign in / create account CTAs; signed-in users redirected to `/library`.
- **/login**, **/signup**: minimal forms, inline validation, generic auth errors, loading states.
- **/library**: "Continue reading" horizontal row; responsive cover grid; search box (debounced);
  sort (recent, title, recently added); floating Upload button; storage usage bar. Skeletons + empty state.
- **/series/[id]**: cover, editable metadata (title/description/tags) with optimistic save; chapter list
  showing read state + per-chapter progress bar; bulk "mark read"; retry failed chapters; delete series (confirm).
- **/upload**: drag-and-drop multiple files and folders; per-file cards with upload progress (incl. multipart
  part progress); after upload, live processing progress via SSE; assign to existing series or create new;
  edit chapter number/title/volume before submit; cancel/abort support.
- **/read/[chapterId]**: the reader (below).
- **/settings**: reading defaults (mode, direction, fit, preload count), theme; active sessions list with
  revoke; change password; storage usage.

**Reader**
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

## 13. Phases

Each phase ends with lint + typecheck + tests green, a manual test guide, and a STOP for review.
Never leave the build broken between phases.

### Phase 1 — Foundations
- [ ] Add deps (app + tooling); configure prettier, vitest, path aliases.
- [ ] `lib/env.ts` Zod env validation (fail fast), `.env.example`.
- [ ] `lib/logger.ts` (pino + request id helper).
- [ ] `lib/db.ts` (mongoose singleton, sanitizeFilter), `lib/redis.ts` (ioredis), `lib/r2.ts` (S3 client + presign helpers).
- [ ] `lib/errors.ts` (ApiError + `withRoute` wrapper), `lib/http.ts` (json, validate, origin check).
- [ ] Security headers in `next.config.ts` + skeleton `proxy.ts`.
- [ ] All Mongoose models with indexes.
- [ ] `GET /api/health`.
- Deliverables: app boots, `/api/health` reports mongo/redis/r2, env fails fast when misconfigured.
- Acceptance: typecheck/lint/tests pass; health returns 200 with all three checks when services up.

### Phase 2 — Auth
- [ ] `lib/auth/*` (password, tokens, session, cookies, requireUser, denylist, lockout).
- [ ] Auth routes (signup, login, refresh w/ rotation+reuse, logout, logout-all, me, change-password, sessions list/delete).
- [ ] `proxy.ts` optimistic gate; rate limiting on auth routes (fail closed).
- [ ] Auth pages (/login, /signup), providers (theme + query client), `fetchWithAuth`.
- [ ] Unit tests: jwt sign/verify, rotation, reuse detection, lockout, password hashing.
- Deliverables: full signup→login→refresh→logout cycle; protected route redirect.
- Acceptance: reused refresh token revokes family; logout invalidates access immediately; 429 on brute force.

### Phase 3 — Upload (API + UI)
- [ ] Presign (single + multipart), parts, complete (HeadObject verify), abort; quota + concurrency guards.
- [ ] `upload.service.ts`, Upload model wiring, rate limit (upload tier).
- [ ] Upload UI: drag-drop, per-file cards, progress, series assign/create, chapter meta edit, abort.
- Deliverables: file lands in R2 `uploads/raw/...`; Chapter created `queued`; job enqueued.
- Acceptance: >100 MB uses multipart; oversize/over-quota rejected; abort aborts multipart.

### Phase 4 — Worker + ingestion (ZIP first)
- [ ] BullMQ setup (`worker/`), graceful shutdown, Zod job payloads, concurrency from env.
- [ ] ZIP adapter (yauzl) with safety limits; clean (junk filter, natural sort, multi-folder split, ch/vol parse).
- [ ] sharp pipeline (rotate, strip, webp 1600/800, thumb, dims, isSpread); R2 upload; DB writes; cache invalidation; raw cleanup.
- [ ] SSE `GET /api/jobs/:id/stream` via QueueEvents (ownership check).
- [ ] Unit tests: detect, naming/sort, junk filter, ch/vol parse, path sanitize; zipbomb + zip-slip fixtures.
- Deliverables: upload a CBZ → processed → pages in R2 → live SSE progress.
- Acceptance: zip bomb + `../` rejected safely; pages 1..120 in numeric order.

### Phase 5 — Library APIs + pages
- [ ] Series + chapter services with caching + version-counter invalidation.
- [ ] Series routes (list/search/sort/paginate, CRUD), chapters route, delete via cleanup queue.
- [ ] Library page (continue row, grid, search, sort, storage bar), series detail page.
- Deliverables: library renders real data; edits invalidate cache; delete enqueues cleanup.
- Acceptance: repeat loads served from Redis; cache invalidated after edits; cross-user list isolation.

### Phase 6 — Reader + progress + settings
- [ ] `GET /api/chapters/:id/pages` (presigned + cached), progress GET/PUT + continue, settings GET/PATCH.
- [ ] Reader (all modes, nav, zoom, preloading, URL refresh, retry-on-403), progress sync, end-of-chapter.
- [ ] Settings page (defaults, theme, sessions, change password, storage).
- Deliverables: read a chapter end to end; progress resumes cross-device.
- Acceptance: no layout shift (reserved dims); progress set on one device resumes on another; URL refresh works.

### Phase 7 — More formats
- [ ] RAR (node-unrar-js), 7z (node-7z + 7zip-bin), PDF (pdfjs-dist + canvas), EPUB (ZIP + OPF spine).
- [ ] Multi-folder → multiple chapters; extended ch/vol parsing.
- [ ] Tests per adapter with tiny fixtures; RAR-renamed-to-.cbz detection.
- Deliverables: all five formats ingest correctly.
- Acceptance: RAR renamed .cbz detected by magic bytes; EPUB spine order preserved; PDF pages rasterized in order.

### Phase 8 — Hardening + ops
- [ ] Full rate-limit coverage (all tiers), security checklist review, CSP finalize.
- [ ] `cleanup` + `maintenance` (repeatable) processors; storage recompute; purge expired uploads; abort stale multipart.
- [ ] Optional Bull Board at `/admin/queues` (admin only).
- [ ] Accessibility pass (Lighthouse 90+ on library + reader).
- [ ] Playwright: signup, login, upload small CBZ, read, progress persists after reload.
- [ ] `Dockerfile.worker`, `docker-compose.yml` (worker, redis, optional app), README (R2 bucket/CORS/lifecycle, Redis, running worker, deploy), `npm audit`.
- Deliverables: production-ready worker image + compose; complete README.
- Acceptance: all acceptance criteria in the task met; lint/typecheck/unit/e2e green; Lighthouse a11y 90+.

---

## 14. Decisions log

- **D1**: Middleware file is `proxy.ts` (Next 16 renamed Middleware → Proxy). Same semantics; edge-safe optimistic auth only.
- **D2**: Route handler params are async (`await ctx.params`) and typed with the global `RouteContext<...>` helper (Next 16 typegen).
- **D3**: Refresh token is an opaque random token (hashed in Mongo), not a JWT. Simpler revocation; only a hash is stored.
- **D4**: Progress uses write-through (Redis + debounced Mongo upsert) rather than a background flush queue, for correct cross-device resume with bounded writes.
- **D5**: Cache invalidation uses per-user/per-series version counters embedded in keys; never `KEYS`/scan.
- **D6**: CSRF handled via SameSite=Lax + Origin/Referer allowlist (not double-submit token), since auth cookies are httpOnly and the SPA is same-origin.
- **D7**: PDF rendering via `pdfjs-dist` + `@napi-rs/canvas`; revisit `pdf-to-img` in Phase 7 if native canvas is problematic on the VPS.
- **D8**: Rate limiting fails **closed on auth routes**, **open elsewhere**.
- **D9**: `zod` and `sharp` already resolve in node_modules transitively; they will be added as explicit direct dependencies.

## 15. Open questions

1. **Signup access**: single-user instance, or open self-serve signups? (Affects whether we add an invite/allowlist or a "signups disabled" env flag.)
2. **Password min length**: I plan 12 chars with no complexity rules (length-first). OK, or do you want a specific policy?
3. **PDF fidelity**: rasterize PDF pages to WebP (loses text selection but consistent with the image reader) — confirm that is acceptable vs. keeping PDFs as-is.
4. **Bull Board admin**: include the `/admin/queues` dashboard (adds `@bull-board/*` deps), or skip for a leaner build?
5. **Deploy target for the app**: worker is Dockerized for a VPS. Is the Next.js app also self-hosted (compose `app` service) or on Vercel? (Affects CSP `connect-src`, cookie `Secure`, and health checks.)
6. **EPUB scope**: image-based EPUBs (manga) render page images cleanly; text-reflow EPUBs (novels) are out of scope for a page reader. Confirm we only target image/fixed-layout EPUBs.
