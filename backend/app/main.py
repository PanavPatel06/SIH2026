"""VAARI backend — FastAPI + SQLite (swap DATABASE_URL for Postgres in production,
see README §15). One file per concern (models/schemas/logic/auth), one router file:
splitting routes further would be the over-engineering the project README warns
against at this size."""
import os
from datetime import datetime, timezone

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from . import models, schemas, logic, auth
from .db import Base, engine, get_db

Base.metadata.create_all(bind=engine)

app = FastAPI(title="VAARI API", version="0.1.0")
# Defaults to the two local dev servers so `npm run dev` works with zero
# setup; a real deployment sets CORS_ORIGINS to its actual frontend URLs
# (comma-separated) — "*" would let any site make authenticated requests
# using a token stolen via XSS elsewhere, which auth.py's bearer tokens
# don't otherwise defend against.
_default_origins = "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


# ------------------------------------------------------------------- auth ---
@app.post("/auth/farmer/register", response_model=schemas.TokenOut)
def register_farmer(payload: schemas.FarmerRegisterIn, db: Session = Depends(get_db)):
    """Identifies each farmer individually (phone number, unique) rather than
    the old open/anonymous registration — no OTP, matching README §15's
    finding that SMS delivery can't be trusted here, so it can't gate login
    either. A PIN is something a low-literacy user can set and re-enter on a
    shared/low-end phone far more reliably than a password."""
    if len(payload.pin) < 4:
        raise HTTPException(400, "PIN must be at least 4 digits")
    if db.query(models.Farmer).filter(models.Farmer.phone == payload.phone).first():
        raise HTTPException(409, "phone already registered — log in instead")
    farmer = models.Farmer(
        name=payload.name, phone=payload.phone, village=payload.village,
        pin_hash=auth.hash_secret(payload.pin),
    )
    db.add(farmer)
    db.commit()
    db.refresh(farmer)
    return {"access_token": auth.make_token(farmer.id, "farmer", auth.FARMER_TOKEN_HOURS)}


@app.post("/auth/farmer/login", response_model=schemas.TokenOut)
def login_farmer(payload: schemas.FarmerLoginIn, db: Session = Depends(get_db)):
    auth.check_login_rate_limit(f"farmer:{payload.phone}")
    farmer = db.query(models.Farmer).filter(models.Farmer.phone == payload.phone).first()
    if not farmer or not auth.verify_secret(payload.pin, farmer.pin_hash):
        raise HTTPException(401, "wrong phone number or PIN")
    return {"access_token": auth.make_token(farmer.id, "farmer", auth.FARMER_TOKEN_HOURS)}


@app.get("/auth/farmer/me", response_model=schemas.FarmerOut)
def farmer_me(farmer: models.Farmer = Depends(auth.get_current_farmer)):
    return farmer


@app.post("/auth/officer/register", response_model=schemas.TokenOut)
def register_officer(payload: schemas.OfficerRegisterIn, db: Session = Depends(get_db)):
    """Self-serve signup is gated by a shared code (set OFFICER_SIGNUP_CODE)
    so random visitors can't hand themselves a dashboard login — a district
    admin hands the code to new officers out of band. Unset means self-serve
    signup is closed entirely (safe default); the seeded demo officer in
    app/seed.py is created directly, bypassing this, same as a real admin
    would via direct DB/console access."""
    expected = os.environ.get("OFFICER_SIGNUP_CODE", "")
    if not expected or payload.signup_code != expected:
        raise HTTPException(403, "invalid signup code — ask your district admin")
    if len(payload.password) < 8:
        raise HTTPException(400, "password must be at least 8 characters")
    if not db.get(models.Centre, payload.centre_id):
        raise HTTPException(404, "centre not found")
    if db.query(models.Officer).filter(models.Officer.email == payload.email).first():
        raise HTTPException(409, "email already registered — log in instead")
    officer = models.Officer(
        email=payload.email, password_hash=auth.hash_secret(payload.password), centre_id=payload.centre_id
    )
    db.add(officer)
    db.commit()
    db.refresh(officer)
    return {"access_token": auth.make_token(officer.id, "officer", auth.OFFICER_TOKEN_HOURS)}


@app.post("/auth/officer/login", response_model=schemas.TokenOut)
def login_officer(payload: schemas.OfficerLoginIn, db: Session = Depends(get_db)):
    auth.check_login_rate_limit(f"officer:{payload.email}")
    officer = db.query(models.Officer).filter(models.Officer.email == payload.email).first()
    if not officer or not auth.verify_secret(payload.password, officer.password_hash):
        raise HTTPException(401, "wrong email or password")
    return {"access_token": auth.make_token(officer.id, "officer", auth.OFFICER_TOKEN_HOURS)}


@app.get("/auth/officer/me", response_model=schemas.OfficerOut)
def officer_me(officer: models.Officer = Depends(auth.get_current_officer)):
    return officer


# ---------------------------------------------------------------- farmers ---
@app.get("/me/bookings", response_model=list[schemas.BookingOut])
def my_bookings(farmer: models.Farmer = Depends(auth.get_current_farmer), db: Session = Depends(get_db)):
    return db.query(models.Booking).filter(models.Booking.farmer_id == farmer.id).all()


# ----------------------------------------------------------------- centres --
@app.post("/centres", response_model=schemas.CentreOut)
def create_centre(
    payload: schemas.CentreIn,
    officer: models.Officer = Depends(auth.get_current_officer),
    db: Session = Depends(get_db),
):
    if officer.centre_id:
        raise HTTPException(403, "only district admins can add new centres")
    centre = models.Centre(**payload.model_dump())
    db.add(centre)
    db.commit()
    db.refresh(centre)
    return centre


@app.get("/centres", response_model=list[schemas.CentreOut])
def list_centres(db: Session = Depends(get_db)):
    return db.query(models.Centre).all()


@app.post("/centres/{centre_id}/capacity", response_model=schemas.CapacityOut)
def set_capacity(
    centre_id: str,
    payload: schemas.CapacityIn,
    officer: models.Officer = Depends(auth.get_current_officer),
    db: Session = Depends(get_db),
):
    """The officer's 30-second morning input (README §8) — bags, labour, trucks
    in, computed capacity + limiting factor out."""
    auth.require_centre_access(officer, centre_id)
    centre = db.get(models.Centre, centre_id)
    if not centre:
        raise HTTPException(404, "centre not found")

    cap_day = (
        db.query(models.CapacityDay)
        .filter(models.CapacityDay.centre_id == centre_id, models.CapacityDay.day == payload.day)
        .first()
    )
    if not cap_day:
        cap_day = models.CapacityDay(centre_id=centre_id, day=payload.day)

    cap_day.gunny_bags = payload.gunny_bags
    cap_day.labour_gangs = payload.labour_gangs
    cap_day.trucks_confirmed = payload.trucks_confirmed
    cap_day.computed_capacity, cap_day.limiting_factor = logic.compute_capacity(
        centre, payload.gunny_bags, payload.labour_gangs, payload.trucks_confirmed
    )
    db.add(cap_day)
    db.commit()
    db.refresh(cap_day)
    return cap_day


@app.get("/centres/{centre_id}/alternatives")
def centre_alternatives(centre_id: str, day: str, db: Session = Depends(get_db)):
    """Standalone lookup — same data the 409 on /bookings carries, exposed so
    the app can suggest a swap *before* a farmer even tries to book a full centre."""
    centre = db.get(models.Centre, centre_id)
    if not centre:
        raise HTTPException(404, "centre not found")
    return logic.find_alternatives(db, centre, day)


@app.get("/centres/{centre_id}/capacity/{day}", response_model=schemas.CapacityOut)
def get_capacity(centre_id: str, day: str, db: Session = Depends(get_db)):
    cap_day = (
        db.query(models.CapacityDay)
        .filter(models.CapacityDay.centre_id == centre_id, models.CapacityDay.day == day)
        .first()
    )
    if not cap_day:
        raise HTTPException(404, "capacity not set for this day yet")
    return cap_day


# ---------------------------------------------------------------- bookings --
@app.post("/bookings", response_model=schemas.BookingOut)
def book_slot(
    payload: schemas.BookingIn,
    farmer: models.Farmer = Depends(auth.get_current_farmer),
    db: Session = Depends(get_db),
):
    centre = db.get(models.Centre, payload.centre_id)
    if not centre:
        raise HTTPException(404, "centre not found")
    cap_day = (
        db.query(models.CapacityDay)
        .filter(models.CapacityDay.centre_id == payload.centre_id, models.CapacityDay.day == payload.day)
        .first()
    )
    if not cap_day or cap_day.computed_capacity <= 0:
        raise HTTPException(400, "no capacity published for this centre/day yet")

    block, position = logic.next_available_slot(db, centre, cap_day)
    if block is None:
        alternatives = logic.find_alternatives(db, centre, payload.day)
        raise HTTPException(
            409,
            {
                "message": "fully booked for this day",
                "alternatives": alternatives,  # cross-centre load balancing (README §5, F9)
            },
        )

    slot_start = logic.slot_start_for_block(cap_day.day, block)
    booking = models.Booking(
        farmer_id=farmer.id,
        centre_id=payload.centre_id,
        day=payload.day,
        slot_start=slot_start,
        queue_position=position,
        predicted_eta=logic.predicted_eta_for(slot_start, position, cap_day.computed_capacity),
        quantity_quintals=payload.quantity_quintals,
        moisture_pct=payload.moisture_pct,
        state="booked",
    )
    db.add(booking)
    db.commit()
    db.refresh(booking)
    return booking


@app.get("/bookings/{token}", response_model=schemas.BookingOut)
def get_booking(token: str, db: Session = Depends(get_db)):
    booking = db.get(models.Booking, token)
    if not booking:
        raise HTTPException(404, "booking not found")
    return booking


@app.post("/bookings/{token}/activate", response_model=schemas.BookingOut)
def activate_booking(
    token: str,
    farmer: models.Farmer = Depends(auth.get_current_farmer),
    db: Session = Depends(get_db),
):
    """Called by the real geofence in app/src/geo.js on entering the 10 km
    radius (README §9), not on app open."""
    booking = db.get(models.Booking, token)
    if not booking:
        raise HTTPException(404, "booking not found")
    if booking.farmer_id != farmer.id:
        raise HTTPException(403, "not your booking")
    booking.state = "activated"
    db.commit()
    db.refresh(booking)
    return booking


@app.post("/bookings/{token}/checkin", response_model=schemas.BookingOut)
def checkin_booking(
    token: str,
    payload: schemas.CheckinIn,
    officer: models.Officer = Depends(auth.get_current_officer),
    db: Session = Depends(get_db),
):
    """Gate operator scans the QR. If the farmer is later than their predicted
    ETA by more than the material threshold, push that delay onto everyone
    still queued today (README §7 steps 12-14, §9)."""
    booking = db.get(models.Booking, token)
    if not booking:
        raise HTTPException(404, "booking not found")
    auth.require_centre_access(officer, booking.centre_id)

    actual = payload.actual_time or datetime.now(timezone.utc)
    actual_naive = actual.replace(tzinfo=None) if actual.tzinfo else actual
    delay_minutes = max(0.0, (actual_naive - booking.predicted_eta).total_seconds() / 60)
    booking.state = "checked_in"
    db.add(booking)
    db.commit()

    if delay_minutes >= logic.MATERIAL_ETA_SHIFT_MINUTES:
        logic.shift_downstream_etas(db, booking.centre_id, booking.day, booking.slot_start, delay_minutes)

    db.refresh(booking)
    return booking


@app.post("/bookings/{token}/weigh", response_model=schemas.BookingOut)
def weigh_booking(
    token: str,
    officer: models.Officer = Depends(auth.get_current_officer),
    db: Session = Depends(get_db),
):
    """Grade against the moisture threshold; accept starts the payment
    pipeline (§12), reject offers an auto-rebook slot instead (§9)."""
    booking = db.get(models.Booking, token)
    if not booking:
        raise HTTPException(404, "booking not found")
    auth.require_centre_access(officer, booking.centre_id)

    risk, reason = logic.rejection_risk(booking.moisture_pct)
    if booking.moisture_pct is not None and booking.moisture_pct > logic.MOISTURE_REJECTION_THRESHOLD:
        booking.state = "deferred"
        db.commit()
        logic.notify(db, booking, f"Not accepted today: {reason} Rebook once dry.")
    else:
        booking.state = "weighed"
        db.add(models.PaymentStage(booking_token=token, stage="weighed", sla_hours=0))
        db.commit()
        logic.notify(db, booking, "Weighed and accepted. Payment tracking has started.")

    db.refresh(booking)
    return booking


# ---------------------------------------------------------------- payments --
@app.get("/bookings/{token}/payment")
def payment_status(token: str, db: Session = Depends(get_db)):
    """Read-triggered escalation, not a cron job (README §12 describes an
    automatic sweep — this is the zero-infrastructure version of the same
    behaviour: the first read after a breach fires it once, `escalated`
    stops it firing again).
    ponytail: a scheduled sweep would catch a breach nobody happens to poll
    for; add one (APScheduler or a cron hitting this loop) if breaches are
    ever silently missed at pilot scale."""
    booking = db.get(models.Booking, token)
    stages = (
        db.query(models.PaymentStage)
        .filter(models.PaymentStage.booking_token == token)
        .order_by(models.PaymentStage.entered_at)
        .all()
    )
    now = datetime.now(timezone.utc)
    out = []
    for stage in stages:
        entered = stage.entered_at if stage.entered_at.tzinfo else stage.entered_at.replace(tzinfo=timezone.utc)
        breached = stage.sla_hours > 0 and (now - entered).total_seconds() / 3600 > stage.sla_hours
        if breached and not stage.escalated and booking:
            logic.notify_officer(
                db,
                booking.centre,
                f"SLA breach: booking {token} stuck at '{stage.stage}' since "
                f"{stage.entered_at.strftime('%Y-%m-%d %H:%M')} (limit {stage.sla_hours}h).",
            )
            stage.escalated = True
            db.add(stage)
            db.commit()
        out.append(
            {
                "stage": stage.stage,
                "entered_at": stage.entered_at,
                "sla_hours": stage.sla_hours,
                "sla_breached": breached,
                "escalated": stage.escalated,
            }
        )
    return out


@app.post("/bookings/{token}/payment/advance")
def advance_payment(
    token: str,
    payload: schemas.AdvancePaymentIn,
    officer: models.Officer = Depends(auth.get_current_officer),
    db: Session = Depends(get_db),
):
    booking = db.get(models.Booking, token)
    if not booking:
        raise HTTPException(404, "booking not found")
    auth.require_centre_access(officer, booking.centre_id)

    valid_stages = [s for s, _ in models.PAYMENT_STAGES]
    if payload.stage not in valid_stages:
        raise HTTPException(400, f"stage must be one of {valid_stages}")
    sla = dict(models.PAYMENT_STAGES)[payload.stage]
    db.add(models.PaymentStage(booking_token=token, stage=payload.stage, sla_hours=sla))
    db.commit()
    if payload.stage == "dbt_credited":
        booking.state = "done"
        db.commit()
    return {"ok": True, "stage": payload.stage}


# ----------------------------------------------------------- notifications --
@app.get("/bookings/{token}/notifications")
def booking_notifications(token: str, db: Session = Depends(get_db)):
    return (
        db.query(models.NotificationLog)
        .filter(models.NotificationLog.booking_token == token)
        .order_by(models.NotificationLog.sent_at)
        .all()
    )


# --------------------------------------------------------------- dashboard --
@app.get("/centres/{centre_id}/bookings", response_model=list[schemas.BookingOut])
def centre_bookings(
    centre_id: str,
    day: str | None = None,
    officer: models.Officer = Depends(auth.get_current_officer),
    db: Session = Depends(get_db),
):
    auth.require_centre_access(officer, centre_id)
    q = db.query(models.Booking).filter(models.Booking.centre_id == centre_id)
    if day:
        q = q.filter(models.Booking.day == day)
    return q.order_by(models.Booking.slot_start).all()
