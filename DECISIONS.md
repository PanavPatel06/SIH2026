# VAARI — Decision Log

Every limitation hit during the build, the call made, and why — so nobody has
to re-derive it later. Newest entries at the bottom. Format: what broke or
was missing → the decision → the reasoning.

Ponytail rules applied throughout: reuse before rebuild, stdlib/native before
a dependency, one runnable check per non-trivial piece of logic, and any
deliberate corner-cut gets a `ponytail:` comment in the code naming the
ceiling and the upgrade path — this file is the index of those comments,
not a replacement for them.

---

### 2026-09-01 — Farmer app: native Kotlin → installable PWA

**Limitation:** README §14 specified Kotlin + Jetpack Compose. This
environment has no Android SDK (`ANDROID_HOME` unset, no SDK directory) — a
native build can't be compiled or verified here.

**Decision:** Build the farmer app as an installable PWA (React + Vite +
a hand-rolled service worker) instead. Same offline-first requirement is met
— works with zero network, installable via "Add to Home Screen" — and it's
buildable/testable in this environment. Also sidesteps the $25 Play Store fee
already ruled out in README §15.

**Status:** Native Android remains a valid upgrade path if SDK access shows
up later; nothing in the architecture (§6 diagram, offline sync design,
notification ladder) depends on which client renders it.

---

### 2026-09-01 — Backend deps: pinned versions failed to build on Python 3.14

**Limitation:** `pip install -r requirements.txt` failed — `pydantic-core`
2.10.4 has no prebuilt wheel for CPython 3.14, and PyO3 (its Rust build tool)
doesn't support 3.14 yet, so pip fell back to a source build with rustc,
which failed outright.

**Decision:** Unpinned `requirements.txt` (fastapi/pydantic/sqlalchemy/
uvicorn with no version pins) so pip resolves to versions that ship a cp314
wheel. Verified working: fastapi 0.141.1, pydantic 2.13.5, sqlalchemy 2.0.52.

**Upgrade path:** pin exact versions once the project settles, so a future
`pip install` doesn't silently drift.

---

### 2026-09-01 — SQLite strips timezone info → checkin crashed

**Limitation:** `POST /bookings/{token}/checkin` threw `TypeError: can't
subtract offset-naive and offset-aware datetimes`. SQLite has no native
`DATETIME WITH TIMEZONE` type, so SQLAlchemy stores `predicted_eta` as naive
even though it's constructed tz-aware; comparing it against an incoming
tz-aware `actual_time` failed.

**Decision:** Normalize the incoming timestamp to naive UTC before
subtracting, matching the convention already used in `payment_status`.

**Verified:** re-ran the full late-checkin flow — booked two farmers,
checked one in 90 minutes late (relative to slot time, not wall clock — see
next entry), confirmed the second farmer's `predicted_eta` shifted and a
notification was logged.

---

### 2026-09-01 — Manual test used wall-clock "now + 90 min" instead of slot-relative time

**Limitation:** Not a code bug — a demo-script mistake. Passed `actual_time`
= current wall clock + 90 minutes. Because this session's local date is a day
ahead of UTC (timezone offset) and the seeded slot was constructed in UTC,
"now" was still numerically *before* the slot's stored time, so the computed
delay came out negative and the material-shift gate never fired.

**Decision:** Rewrote the manual test to compute `actual_time` relative to
the booking's own `slot_start` (`slot_start + 90 min`) instead of wall clock.
This is how a real gate-scan timestamp behaves — it's always relative to that
day's slots — so no code changed, just the test.

---

### 2026-09-01 — vite-plugin-pwa broke the build (path contains an apostrophe)

**Limitation:** `npm run build` on the farmer PWA failed inside
`workbox-build`: it generates the service worker's import statements as
single-quoted strings containing absolute `node_modules` paths, and this
project's folder is `.../Panav's Workspace/...` — the apostrophe terminates
the quoted string early, producing invalid JS.

**Decision:** Dropped `vite-plugin-pwa` entirely. Replaced it with a
25-line hand-rolled `public/sw.js` (cache-first for the built shell,
network-passthrough for API calls) plus a static `public/manifest.webmanifest`.
This is *less* code than configuring Workbox would have been, and it has no
dependency on how the OS quotes file paths — the boring stdlib-adjacent
option (the raw Service Worker API) simply doesn't have this failure mode.

**Verified:** `npm run build` succeeds; `dist/sw.js` and
`dist/manifest.webmanifest` are present; dev server serves both with 200.

---

### 2026-09-01 — Redis never added (matches README §15, noted here for the code, not just the doc)

**Limitation/decision already made in README §15:** live queue state doesn't
need Redis at pilot scale (one district, ~50 centres) — Postgres/SQLite
handles it. Confirmed while building: `Booking.state` + `predicted_eta`
columns in the same transactional store are enough for the whole
book → checkin → shift-downstream-ETAs → weigh → pay loop.

**Upgrade path (`ponytail:` in `app/models.py` and `app/logic.py`):** move
queue state to Redis when a single centre exceeds ~200 scans/hour or ETA
recompute latency exceeds 2s.

---
### 2026-09-01 — Notification channels formalized (push / WhatsApp / email / SMS)

**Limitation:** The first backend pass only had two channels (`email`,
`console`) and console was silently standing in for everything else.

**Decision:** Split into four named channels matching README §10/§15
exactly: `push` (console stand-in — no FCM/VAPID keys in this dev build),
`whatsapp` (mocked unless `WHATSAPP_TOKEN` is set), `email` (real if
`SMTP_*` is set, else logs and reports success so the ladder doesn't stall
on an unconfigured channel), `sms` (**always** mocked and always reports
`delivered=False` — this is deliberately the one channel that never claims
success it can't back up, because it's the tier a state's DLT gateway is
supposed to plug into, and pretending otherwise would defeat the point of
showing this on the officer dashboard).

**Verified:** re-ran the late-checkin flow; ladder walks push→whatsapp→
email→sms, each attempt logged in `notification_log` with its real
`delivered` outcome.

---

### 2026-09-01 — SLA-breach auto-escalation to the officer

**Gap closed:** README §12 describes an SLA breach auto-escalating to the
district officer; the backend computed `sla_breached` but never notified
anyone.

**Decision:** Added `Centre.officer_email` and `PaymentStage.escalated`.
`GET /bookings/{token}/payment` — the read path — fires
`logic.notify_officer(...)` the first time it sees a breached, unescalated
stage, then sets `escalated=True` so it never re-fires for that stage.

**Trade-off, stated plainly:** this is a read-triggered check, not a
scheduled sweep — a breach nobody happens to poll for won't escalate.
Fine at pilot scale (the officer dashboard polls routinely); flagged with a
`ponytail:` comment in `app/main.py` for a real cron/APScheduler sweep if
that gap ever matters.

**Verified:** booked → weighed → advanced to `jform_issued` → backdated its
`entered_at` 2 days via sqlite to force a breach → first `GET /payment`
fired exactly one `officer_escalation` notification → second `GET` fired
zero more. Confirmed via direct DB query (`SELECT COUNT(*) ... = 1`).

---

### 2026-09-01 — Officer dashboard map: backlog colour-coding

**Gap closed:** README §6 promises a "live backlog heatmap" on the officer
dashboard; the map only showed plain markers.

**Decision:** Colour each centre's marker by today's booked ÷ capacity
ratio — green under 70%, orange 70–100%, red at/over 100% — computed
client-side from the existing `/centres/{id}/capacity/{day}` and
`/centres/{id}/bookings` endpoints (no new backend route needed). Added a
legend under the map and an `officer_email` field to the "add centre" form
so escalations above have somewhere to go.

---

### 2026-09-01 — Gate operator: reused the existing Bookings page instead of building a separate app

**Limitation:** README §17 (F8, Phase 2) calls for a "gate operator offline
app" with QR scanning.

**Decision:** Deliberately *not* built as a separate app. The officer
dashboard's Bookings page (`web/src/pages/Bookings.jsx`) already has
per-booking check-in/weigh buttons — that *is* the gate operator's workflow,
just typed instead of scanned, and it already reuses the same backend
endpoints (`/checkin`, `/weigh`) a real scanner would call. Building a
second, QR-scanning, offline-capable app for the same two buttons would be
exactly the "boilerplate for later" ponytail argues against — the actual
missing piece (a camera-based QR reader + true offline queueing) is a
five-minute add to the existing page once there's a real camera/device to
test it against, not a new project.

**Deferred, not abandoned:** camera QR scanning stays a real gap for a true
field pilot (typing an 8-character token by hand doesn't scale past a demo).
Upgrade path: add a QR-scan library to the existing Bookings page pointed at
the same `/checkin` endpoint — no backend change needed.

---

### 2026-09-01 — Cross-centre load balancing (README §5, F9) — built, not deferred

**Why this one, and not IVR/state-portal integration alongside it:** it's
the one Phase 3 item that needs zero external accounts, credentials, or
paid infrastructure — pure logic over data the backend already has. It's
also the mechanism from the original brainstorm that actually *reduces*
congestion district-wide rather than just managing the queue at one centre,
so it earned inclusion in Phase 1 rather than staying deferred to Phase 3.

**What was built:** `haversine_km()` (stdlib `math`, no new dependency) +
`find_alternatives()` in `backend/app/logic.py` — ranks other centres by
today's backlog ratio, then distance, excluding any that are themselves
≥90% booked. Wired in two places: the `/bookings` 409 response now carries
`alternatives` inline, and a standalone `GET /centres/{id}/alternatives`
endpoint exists for the app to check proactively. The farmer app surfaces
this as a "Try X instead — N trolleys free, N km away" card with a one-tap
centre switch.

**Bug found while verifying this** (see next two entries) — building this
feature is what surfaced them, because it required deliberately filling a
centre to capacity, which the demo path (capacity=38) never had reason to do.

---

### 2026-09-01 — Bug: `int()` truncation silently zeroed out small centres

**Found while testing cross-centre load balancing**, not by inspection —
set a centre's capacity so the binding constraint resolved to exactly 1
trolley, with the seeded `efficiency_factor=0.85`. `compute_capacity`
returned **0**, not 1: `int(1 * 0.85)` truncates to 0. Any small raw
capacity combined with a realistic sub-1.0 efficiency factor (which is the
norm, not the exception — see README §8's calibration-knob note) would
silently take a real centre offline for the day.

**Fix:** `round()` instead of `int()` in `compute_capacity`
(`app/logic.py`). All 8 existing tests still pass unchanged (they use
capacities large enough that rounding vs. truncating never differed);
added `test_capacity_rounds_instead_of_truncating_to_zero` as the
regression check.

---

### 2026-09-01 — Bug: low-capacity days silently allowed up to 12× their real capacity

**Found immediately after fixing the bug above**, while re-running the same
manual test: a centre correctly computed to 1-trolley capacity still
accepted a **second** booking. Root cause was in `next_available_slot`, not
`compute_capacity` — it computed `per_block = max(1, computed_capacity //
SLOT_BLOCKS)`, flooring every block to a minimum of 1 slot regardless of the
day's actual capacity. With 12 hourly blocks, a 1-trolley day could take up
to 12 bookings; more generally, any day with `computed_capacity < 12` had
its real cap silently ignored.

**Fix:** distribute `computed_capacity` exactly across the 12 blocks
(remainder to the first blocks, same idea as splitting a remainder in
payroll rounding) instead of flooring each block to a minimum of 1. A block
that lands on 0 capacity simply isn't offered. This also fixed a smaller
version of the same bug at normal capacity — the old `max(1, 38 // 12) = 3`
constant-per-block scheme only ever allowed 3×12=36 bookings against a
computed capacity of 38, quietly discarding 2 real trolleys' worth of
capacity every day.

**Verified two ways:**
1. Unit tests: `test_low_capacity_day_does_not_allow_more_bookings_than_its_capacity`
   and `test_full_capacity_is_distributed_exactly_across_blocks` (38 → sums
   back to exactly 38, not 36).
2. End-to-end: reseeded, set a centre to capacity=1, booked it once (200),
   booked it again (correctly 409'd with an alternative centre suggested).
   Then re-published the same centre back to capacity=38 and re-ran the
   original Sehore-3 demo flow (four bookings, block overflow behaving
   correctly given a leftover booking from the capacity=1 test) to confirm
   the fix didn't regress the main demo path.

**Why this matters beyond the fix itself:** both bugs were sitting in the
project's single most safety-critical number — the one the entire pitch
(§1: "tell farmers when *not* to come") depends on being trustworthy. An
ETA or a capacity number that's wrong once is the exact failure mode
README §18 calls out as fatal to farmer trust in the system. Worth noting
for the demo script: neither bug was visible at the capacity the seed data
happened to use (38) — they only surfaced by deliberately testing an edge
case (a nearly-empty centre) that a normal demo run would never hit.

---

### 2026-09-01 — Scope boundary for "project complete"

Stating this explicitly rather than letting "keep going" run into work that
isn't actually buildable here.

**Built and verified this session:** the full Phase 1 loop (capacity engine,
slot booking, virtual queue, live ETA shifting, on-device advisor, offline
PWA with outbox sync) plus most of Phase 2 (payment SLA tracking + officer
escalation, officer dashboard with a live backlog map, cross-centre load
balancing pulled forward from Phase 3 since it needed no external
infrastructure).

**Not built, and why — these need the user's own accounts/access, not more
engineering time:**
- **Native Android app** — no Android SDK in this environment (see first
  entry in this log). PWA substitute is real and works; a Kotlin rebuild
  needs someone with Android Studio.
- **Real WhatsApp Cloud API / SMS DLT gateway** — need a Meta Business
  account and (for SMS) a registered Indian business entity respectively.
  The ports are built and mocked; flipping them to real needs credentials
  only the user can obtain.
- **IVR** — needs a telephony provider account.
- **State portal integration** — needs a specific state's API access,
  which in turn needs the "which state?" decision from README §20 to even
  be answerable. No stub was built for this either — a speculative adapter
  for an unknown API would be exactly the "boilerplate for later" ponytail
  argues against.
- **Production deployment** (Oracle Cloud / Supabase / GitHub Student Pack)
  — needs the user to create and authenticate those accounts.

Everything in this "not built" list is called out, with reasoning, rather
than silently skipped — per the project's own working agreement.

---

### 2026-09-01 — Real geofence (README §9) — replaced the manual "arrived" button

**Limitation:** `activate_booking` in `main.py` was always going to be a
manual trigger server-side (there's no way to *verify* GPS server-side
without a paid geocoding/anti-spoofing service, and that's rightly out of
scope). But the app's button just said "I'm on my way" and did nothing to
check it — that's not a geofence, that's a relabeled confirm button, and it
undersells what README §17's demo script actually promises ("Geofence
activates the token on approach").

**Decision:** Added `app/src/geo.js` — a stdlib-only haversine distance
(mirrors `backend/app/logic.py`'s `haversine_km`, same formula, so both
sides agree) plus `getDistanceToCentre()` using the browser's native
Geolocation API. `MyBookings.jsx`'s new `GeofenceButton` checks real
device GPS against the centre's stored lat/lon and auto-activates within
10 km; if the farmer is farther away, it says so and offers a manual
override; if GPS is unavailable/denied (no signal, permission refused,
older device), it falls back to the original one-tap manual button
immediately — never blocks the flow, same "never a blank screen" pattern
as the on-device advisor (README §11).

**Verified:** `app/src/geo.test.mjs` (`node src/geo.test.mjs`) — same-point
distance is 0, Delhi→Mumbai lands in the expected ~1150 km range. Added the
equivalent `test_haversine_km_matches_known_distance` to
`backend/test_logic.py` since `haversine_km`/`find_alternatives` (added
last session) had no direct unit test yet — now 11/11 backend tests pass.
Could not test actual device GPS in this environment (no hardware here);
the permission-denied/no-GPS fallback path is what carries that risk, and
it degrades to the previously-shipped manual button, so nothing regresses
even if geolocation misbehaves on a real device.

---

### 2026-09-01 — QR token display + camera check-in scanning (README §17 step 5)

**Limitation:** the gate operator flow required an officer to type an
8-character token by hand for every farmer — workable for a demo, not
believable as "gate scans offline" for a real pilot. Previously logged
(see the "Gate operator" entry above) as a deferred 5-minute add "once
there's a camera/device to test it against" — still true, so this is built
defensively: additive only, nothing removed, so it costs nothing if a real
device turns out not to support it.

**Decision:**
- **Farmer side** (`app/src/pages/MyBookings.jsx`): renders the booking
  token as a QR code via the `qrcode` package (client-side only, no network
  call — a booking token is not sensitive, so no reason to keep the QR
  itself off-device). New dependency, justified — a QR encoder is not a
  "few lines" (ladder rung 6 fails), and `qrcode` is small and well-worn.
- **Officer side** (`web/src/pages/Bookings.jsx`): a "📷 Scan to check in"
  button using the browser's **native `BarcodeDetector` API** — deliberately
  *not* a new npm dependency (ladder rung 4 beats rung 5: native platform
  feature over library). Decodes frames from `getUserMedia`, calls the
  existing `/checkin` endpoint with the decoded token — no backend change.
- **Graceful degradation, twice over:** if `BarcodeDetector` isn't
  supported (Safari lacks it) the scan button doesn't render at all — the
  original typed-token table buttons are untouched and still work. If the
  camera fails to open, the component says so and the table is still
  right there. Nothing a working demo depended on before this can break
  because of this.

**Verified:** both `web` and `app` build cleanly (`npm run build`, no
errors). Actual camera/QR decoding is untestable in this headless
environment — flagged honestly rather than claimed as verified; the
fallback paths are what absorb that risk.

**Not done:** auth for the officer dashboard and farmer app (still none).
Considered and deliberately skipped this round — it's not on README's own
roadmap (§17 lists F1–F11; none is "auth"), and building a real login
system competes for scope with a hackathon demo's actual judged criteria
without moving the core loop forward. It belongs with "production
deployment" in the scope-boundary list above, alongside Postgres/hosting —
real auth wants real user accounts and a real deployment target, not a
speculative login screen bolted onto a demo. Flagging here rather than
silently leaving it undiscussed.

---

### 2026-09-01 — Auth system: farmer phone+PIN, officer email+password (user request, reverses the earlier "skip auth" call)

**Context:** logged earlier this session that auth was deliberately skipped
as out of README's roadmap and better bundled with production deployment.
The user asked directly for it — "essential for the system to work securely
and also to identify each farmer individually" — which overrides that
default. Building it now, properly, not as a stub.

**Decision — farmer side:** phone + PIN, not phone + OTP. README §15
already established SMS delivery can't be trusted here (no DLT access) —
that finding kills SMS as a login gate exactly as it killed it as a
notification channel. A 4+ digit PIN a farmer sets once is something they
can reliably re-enter on a shared/low-end phone; it's also what most rural
fintech/UPI apps already train users to expect. Phone number stays the
unique identifier ("identify each farmer individually"), enforced with a
DB-level unique constraint, not just an application check.

**Decision — officer side:** email + password, self-serve registration
gated by a shared `OFFICER_SIGNUP_CODE` env var so random visitors can't
hand themselves a dashboard login — a district admin distributes the code
out of band. Unset means self-serve signup is closed entirely (safe
default); demo/admin officers are created directly via `app/seed.py`,
bypassing the code the same way a real admin would via direct DB access,
not through the public endpoint.

**Decision — token signing:** PyJWT (HS256), one new dependency, chosen
over hand-rolling HMAC signing even though the latter is ~20 lines. Auth is
explicitly called out in this project's working agreement as something
never to simplify away on security grounds — reinventing a signer, however
small, is exactly that kind of corner-cut on a security-critical path. A
missing `SECRET_KEY` env var falls back to a random per-process secret
(logged loudly) rather than a fixed default or a hard crash, so local dev
still works with zero setup but nobody can be silently shipped a forgeable
default in production.

**Decision — password/PIN hashing:** stdlib `hashlib.scrypt` (memory-hard),
salted per-user, no new dependency — the hashlib docs recommend it for
exactly this, and it avoids adding bcrypt/passlib/argon2 for something the
standard library already does correctly.

**What's actually protected, and what deliberately isn't:**
- Farmer-auth-required: booking creation (farmer_id now comes from the
  token, never the request body — a farmer can no longer book *as* someone
  else even by editing the request), the geofence activate call (checked
  against the booking's owner), and the "my bookings" list (`/me/bookings`
  replaces the old `/farmers/{id}/bookings`, so there's no id parameter to
  spoof in the first place).
- Officer-auth-required, centre-scoped: publishing capacity, check-in,
  weigh, payment-stage advance, and the dashboard's per-centre booking
  list. `require_centre_access()` in `app/auth.py` is one shared gate all
  of these route through — a centre-scoped officer's token literally cannot
  touch another centre's data, at the API layer, regardless of what the
  frontend shows. Creating a new centre requires an admin token
  (`centre_id is None` on the officer row); a district admin account is
  seeded/created directly, not self-registered.
- **Deliberately left capability-protected only, not auth-gated:**
  `GET /bookings/{token}`, `GET /bookings/{token}/payment`, and
  `GET /bookings/{token}/notifications`. These are read-only status
  lookups keyed by an unguessable 8-char token — the same protection they
  had before auth existed, and the token is the QR code a farmer's phone
  shows at the gate, so it already behaves as a bearer capability by
  design. Adding full dual-role auth here (farmer-owns-it OR
  officer-has-centre-access) would be real complexity for read-only status
  data that isn't the thing "identify each farmer individually" was asking
  to fix — flagging the boundary rather than silently leaving it undecided.
- **Still no auth:** `GET /centres`, `/centres/{id}/capacity/{day}`,
  `/centres/{id}/alternatives` — public centre listings and capacity
  numbers, non-sensitive, same reasoning as a public procurement-centre
  directory.

**Frontend:** both apps gate their whole UI behind a login/register screen
now (`app/src/pages/Auth.jsx`, `web/src/pages/Auth.jsx`), store the bearer
token in `localStorage`, attach it to every request, and validate it
against `/auth/*/me` on load rather than trusting a locally-cached farmer/
officer object — an expired or tampered token now bounces back to login
instead of rendering a broken Home page. The officer dashboard additionally
filters the centre list/map to a centre-scoped officer's own centre and
hides the "add centre" admin action for non-admins — pure UX, the real
enforcement is server-side and doesn't depend on this.

**Verified:** 3 new backend tests (`test_password_hash_roundtrips_and_rejects_wrong_secret`,
`test_token_roundtrips_and_rejects_tampering`, `test_expired_token_is_rejected`)
— 14/14 pass. End-to-end smoke test against the live server: login issues a
token; wrong PIN → 401; booking without a token → 401; booking with a
farmer token succeeds and is attributed to that farmer; check-in/weigh
without an officer token → 401, with one → succeeds; a second farmer's
token cannot activate the first farmer's booking → 403; a centre-scoped
officer cannot create a new centre → 403. Both frontends build clean.

---

### 2026-09-01 — Production hardening pass (user request: "make both web and app as close to production as possible")

Everything below closes a real gap between "works in a demo" and "safe to
actually deploy," scoped to what's fixable in code/config alone — nothing
here needed an external account.

**Backend:**
- **CORS**: was `allow_origins=["*"]`, now a `CORS_ORIGINS` env var
  (comma-separated), defaulting to the two local dev ports. `*` on an API
  that issues bearer tokens is a real gap, not cosmetic — any site could
  make authenticated requests using a token exfiltrated via XSS elsewhere,
  since `*` disables the browser's own origin check entirely.
- **Login rate limiting**: farmer PINs are deliberately short (4+ digits,
  10,000 combinations — the whole point of PIN-not-OTP, see the earlier
  auth entry) with nothing else limiting guesses until now. Added an
  in-memory sliding-window limiter (`auth.check_login_rate_limit`, 5
  attempts / 15 min, keyed by the phone/email being guessed) on both login
  routes. `ponytail:` flagged as per-process/in-memory — fine at one
  worker, needs Redis if this ever scales past that; documented rather than
  built speculatively.
- **Officer password minimum length** (8 chars) — PIN already had a floor,
  password didn't.
- **SECRET_KEY**: previously always fell back to a random per-process
  secret with a warning. Now checks `ENVIRONMENT` — in `production`, a
  missing `SECRET_KEY` raises at startup instead of silently degrading.
  Reasoning: a random-per-process secret isn't just "less secure," it's
  actively broken with more than one worker (each process signs with a
  different key, so tokens fail across workers) — this needed to be a hard
  failure, not a log line nobody reads in production.
- **requirements.txt pinned** to the exact versions already tested this
  session (`fastapi==0.141.1` etc.) instead of unpinned — unpinned was a
  necessary workaround for the Python 3.14 wheel issue (first entry in this
  log), not a permanent choice; pinning now makes builds reproducible
  without reopening that problem, with a comment on how to unpin again if a
  future Python breaks a wheel the same way.
- **`Dockerfile` + `.dockerignore`** added — a concrete deploy artifact for
  README §15's container-host target (Oracle Cloud Always Free), not just a
  paragraph describing one.
- **`.env.example`** documents every env var the app actually reads (cross-
  checked against `auth.py`/`main.py`/`logic.py`/`db.py` source, not
  guessed) so a real deploy isn't a game of grepping the codebase for
  `os.environ.get`.

**Both frontends:**
- **React `ErrorBoundary`** added to each (`app/src/ErrorBoundary.jsx`,
  `web/src/ErrorBoundary.jsx`) — previously one uncaught render error
  whitescreened the entire app with no recovery. Now shows a reload prompt.
  Worse than usual for this project specifically: a farmer standing at a
  gate on one bar of signal has no patience for a blank screen.
- **`.env.example`** for `VITE_API_BASE` in both.
- **`public/_headers`** in both (Netlify/Cloudflare Pages convention, the
  two zero-cost static hosts README §15 names) — CSP, `X-Frame-Options:
  DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a
  `Permissions-Policy` that's the mirror image between the two apps
  (farmer app: geolocation allowed, camera denied — it only ever uses GPS
  for the geofence; officer dashboard: camera allowed for the QR scanner,
  geolocation denied — it never asks for the officer's location). CSP's
  `img-src`/`connect-src` cross-checked against actual external URLs in
  the code (`grep -rn https://`), not assumed.
- **Service worker cache cleanup**: `activate` now deletes any cache not
  matching the current `SHELL_CACHE` name — previously nothing ever ran
  that cleanup, so bumping the cache version on a future deploy would have
  left the old cache orphaned forever instead of freed. `ponytail:` comment
  left on the remaining known ceiling (individual old-hash bundle entries
  within the *current* cache version aren't evicted — that's Workbox's
  job; not rebuilding it by hand unless cache bloat is an actual observed
  problem, not a theoretical one).

**Repo-level:**
- **`.github/workflows/ci.yml`** — runs backend self-checks + both frontend
  builds on every push/PR. Real, not aspirational: `origin` is already a
  live GitHub remote (`PanavPatel06/SIH2026`), so this activates the moment
  it's pushed.
- **`.gitignore`** extended to `.env`/`.env.local` — the new `.env.example`
  files make a real `.env` sitting in the same directory the working
  default, so a stray commit of one had to be blocked, not just discouraged.

**Verified:** 15/15 backend tests (added `test_login_rate_limit_blocks_after_max_attempts`).
Confirmed `ENVIRONMENT=production` without `SECRET_KEY` raises at import
time rather than degrading silently. Both frontend builds clean, including
the new `_headers` files landing in `dist/`. `sw.js` re-checked with `node
--check` after editing (it's unbundled, hand-written, and ships straight to
`public/` — a syntax error there fails silently in the browser, not at
build time, so it needed an explicit check).

**Still not "production" in the sense of "deployed"** — no server has
actually been provisioned, no domain, no TLS certificate, no real SMTP/
WhatsApp credentials plugged in. That's the accounts-and-credentials
boundary from the earlier scope entry, unchanged. What changed here is
that the code and config are now ready for that step rather than assuming
a trusted, single-process, `localhost`-only environment.
