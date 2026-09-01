# Running VAARI locally

Three pieces. Backend first — both frontends call it.

## 1. Backend (FastAPI + SQLite) — port 8000

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export SECRET_KEY=$(openssl rand -hex 32)      # signs login tokens — see app/auth.py
python3 -m app.seed          # creates the Sehore-3 demo centre + Ramesh + a demo officer login
python3 test_logic.py        # self-check: capacity engine, ETA, rejection risk, auth
uvicorn app.main:app --reload --port 8000
```

`app/seed.py` prints two demo logins to use in the two frontends below:
- **Farmer app:** phone `9800000001`, PIN `1234`
- **Officer dashboard:** `officer@sehore3.example.org` / `demo1234`

New officers can self-register from the dashboard's login screen, gated by a
shared code: `export OFFICER_SIGNUP_CODE=some-code` before starting the
backend, then hand that code to whoever needs a login. Leave it unset to
keep self-serve signup closed (the seeded officer above still works).

API docs (auto-generated): http://localhost:8000/docs

## 2. Officer dashboard (React + Leaflet) — port 5173

```bash
cd web
npm install
npm run dev
```
→ http://localhost:5173 — use `localhost`, not `127.0.0.1` (Vite binds IPv6 by default).

Log a centre's capacity here first (bags/labour/trucks) — the farmer app can't book against a centre with no capacity published for the day.

## 3. Farmer app (installable PWA) — port 5174

```bash
cd app
npm install
npm run dev
```
→ http://localhost:5174. "Add to Home Screen" on a phone to install it. Kill your network after the first load — the shell (via `public/sw.js`) and last-fetched data (via `localStorage`, see `src/offline.js`) both keep working offline, and the slot advisor (`src/advisor.js`) runs entirely on-device.

## The demo loop

1. **web** → log in as the demo officer → pick Sehore-3 → publish today's capacity → note the limiting factor
2. **app** → register (or log in as demo farmer Ramesh) → see the on-device recommendation + rejection risk → book
3. **web → Bookings tab** → check the booking in *late* → watch other bookings' ETA shift and a notification land (`GET /bookings/{token}/notifications` or the backend console log)
4. **web** → weigh it → advance through the payment stages → SLA badges

## What's real vs. mocked right now

| Piece | Status |
|---|---|
| Capacity engine, slot assignment, queue math, ETA shifting | Real, tested (`backend/test_logic.py`, 14 checks) |
| Cross-centre load balancing (README §5, F9) | Real — a full centre's 409 response carries ranked nearby alternatives; farmer app offers a one-tap switch |
| Payment SLA tracking + officer auto-escalation | Real — first read after a breach emails/logs the officer once (dedup via `escalated` flag), not a cron sweep — see `DECISIONS.md` |
| Notification ladder — push, email | Real. Push = console (no FCM/VAPID keys wired yet). Email sends for real if `SMTP_*` env vars are set, else logs and reports success. |
| Notification ladder — WhatsApp, SMS | Mocked and logged, matching README §15: WhatsApp needs `WHATSAPP_TOKEN`; SMS always logs but reports undelivered — it's the port a state's DLT gateway plugs into, not something a student team can wire for real |
| Officer dashboard map | Real — markers colour-coded by today's booked/capacity ratio (green/orange/red) |
| Gate operator | Folded into the officer dashboard's Bookings page. Check-in is now scannable — a native `BarcodeDetector` camera scanner reads the farmer's QR — with the original typed-token buttons kept as fallback; see `DECISIONS.md` |
| Geofence activation | Real — checks device GPS (Geolocation API) against the centre's coordinates and auto-activates within 10 km, with a manual fallback if GPS is unavailable |
| Booking QR code | Real — farmer's "My bookings" screen renders the token as a QR code (`qrcode` package), scanned by the officer-side camera scanner above |
| Rejection-risk / wait-time model | Rule-based (both backend and on-device) — placeholder for the trained model in README §11 |
| Auth | Real — farmer phone+PIN, officer email+password, signed bearer tokens (JWT/HS256), route-level enforcement (a farmer can only book/activate as themselves; an officer is scoped to their own centre unless seeded as admin). See `DECISIONS.md`. |
| IVR, state portal integration | Not built — needs telephony/state infrastructure this project can't get without your accounts. See `DECISIONS.md`. |

See the root [README.md](README.md) for the architecture and reasoning, and [DECISIONS.md](DECISIONS.md) for every limitation hit and the call made on it.

## Going to production

Everything below is already built — this is the checklist for turning it on
for a real deployment rather than local dev, where every one of these has a
safe, working default.

1. **Backend** — copy `backend/.env.example` to `.env` (or set these as real
   env vars on your host) and fill in:
   - `ENVIRONMENT=production` — makes the app refuse to start without a real
     `SECRET_KEY` instead of silently using a random per-process one (which
     breaks sessions across restarts and across `--workers N`).
   - `SECRET_KEY` — `openssl rand -hex 32`. Same value on every worker/instance.
   - `CORS_ORIGINS` — your real deployed frontend URLs, comma-separated.
     Defaults to the two local dev ports only.
   - `DATABASE_URL` — a Postgres URL (Supabase/Neon free tier, README §15)
     instead of the local SQLite file, so data survives a redeploy.
   - `OFFICER_SIGNUP_CODE` — set it and hand the code to real officers, or
     leave unset and create accounts directly (see `app/seed.py`'s pattern).
   - Deploy via `backend/Dockerfile` (`docker build -t vaari-backend .`) on
     any container host — Oracle Cloud Always Free per README §15.
   - Farmer/officer login is rate-limited (5 attempts / 15 min per phone or
     email) — in-memory, per-process; move it to Redis if you ever run more
     than one backend worker (see the `ponytail:` note in `app/auth.py`).
2. **Both frontends** — copy `.env.example` to `.env.local` and set
   `VITE_API_BASE` to your deployed backend URL, then `npm run build` and
   deploy the `dist/` folder to any static host (Cloudflare Pages / Netlify
   free tier). Each ships a `public/_headers` file (security headers —
   CSP, frame-blocking, permissions) that those two hosts read automatically;
   other static hosts ignore it harmlessly, so set equivalent headers there
   yourself if you're not using one of the two.
3. **CI** — `.github/workflows/ci.yml` runs the backend self-checks and
   builds both frontends on every push/PR once this repo is on GitHub with
   Actions enabled (it already is — `origin` is a real GitHub remote).
4. **Not covered here because it needs your own accounts, not more
   config** — native Android, real WhatsApp/SMS, IVR, state portal
   integration. See `DECISIONS.md`'s scope-boundary entries.
