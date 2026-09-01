"""Capacity engine, queue/ETA math, and the notification ladder — README §8-§10.

Constants below are pilot assumptions (bags per trolley, weighbridge throughput,
etc.) — not measured. Tune them from real centre data once you have a pilot.
"""
import math
import os
import smtplib
from email.mime.text import MIMEText
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session
from . import models

OPERATING_START_HOUR = 6
OPERATING_END_HOUR = 18
OPERATING_MINUTES = (OPERATING_END_HOUR - OPERATING_START_HOUR) * 60
SLOT_BLOCKS = OPERATING_END_HOUR - OPERATING_START_HOUR  # one block per hour

# ponytail: assumed throughput constants, replace with values measured at a real
# pilot centre once available — nothing downstream needs to change to update them.
BAGS_PER_TROLLEY = 50
TROLLEYS_PER_WEIGHBRIDGE_PER_HOUR = 4
TROLLEYS_PER_LABOUR_GANG_PER_DAY = 15
TROLLEYS_PER_TRUCK = 25

MATERIAL_ETA_SHIFT_MINUTES = 45  # README §10 "Material?" gate
MOISTURE_REJECTION_THRESHOLD = 12.0  # % — FCI norm for wheat


def compute_capacity(centre: models.Centre, gunny_bags: int, labour_gangs: int, trucks_confirmed: int):
    """MIN of every real constraint, per README §8. Returns (capacity, limiting_factor)."""
    limits = {
        "gunny bags": gunny_bags // BAGS_PER_TROLLEY,
        "weighbridges": centre.weighbridges * TROLLEYS_PER_WEIGHBRIDGE_PER_HOUR * (OPERATING_MINUTES // 60),
        "labour": labour_gangs * TROLLEYS_PER_LABOUR_GANG_PER_DAY,
        "evacuation trucks": trucks_confirmed * TROLLEYS_PER_TRUCK,
    }
    limiting_factor = min(limits, key=limits.get)
    # round, not truncate — int() would floor e.g. 1 trolley * 0.85 efficiency
    # to 0, silently taking a real centre offline for the day.
    capacity = max(0, round(limits[limiting_factor] * centre.efficiency_factor))
    return capacity, limiting_factor


def slot_start_for_block(day, block_index: int) -> datetime:
    return datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc) + timedelta(
        hours=OPERATING_START_HOUR + block_index
    )


def avg_service_minutes(computed_capacity: int) -> float:
    if computed_capacity <= 0:
        return float(OPERATING_MINUTES)
    return OPERATING_MINUTES / computed_capacity


def next_available_slot(db: Session, centre: models.Centre, cap_day: models.CapacityDay):
    """Earliest hour-block that still has room, and how many bookings are
    already ahead of a new one in that block (== this booking's queue position).

    Distributes computed_capacity exactly across the 12 blocks (remainder to
    the first ones) rather than flooring each block to a minimum of 1 —
    that floor used to let a 1-trolley day take up to 12 bookings (one per
    block), silently ignoring the capacity engine's own number."""
    base = cap_day.computed_capacity // SLOT_BLOCKS
    remainder = cap_day.computed_capacity % SLOT_BLOCKS
    for block in range(SLOT_BLOCKS):
        block_cap = base + (1 if block < remainder else 0)
        if block_cap == 0:
            continue
        count = (
            db.query(models.Booking)
            .filter(
                models.Booking.centre_id == centre.id,
                models.Booking.day == cap_day.day,
                models.Booking.slot_start == slot_start_for_block(cap_day.day, block),
                models.Booking.state != "released",
            )
            .count()
        )
        if count < block_cap:
            return block, count
    return None, None


def predicted_eta_for(slot_start: datetime, queue_position: int, computed_capacity: int) -> datetime:
    return slot_start + timedelta(minutes=queue_position * avg_service_minutes(computed_capacity))


def rejection_risk(moisture_pct: float | None) -> tuple[float, str]:
    """Threshold rule — a stand-in for the trained rejection-risk model in
    README §11. Swap for the ONNX-exported model once historical data exists."""
    if moisture_pct is None:
        return 0.1, "No moisture reading yet — assuming dry."
    if moisture_pct <= MOISTURE_REJECTION_THRESHOLD:
        return 0.05, f"Moisture {moisture_pct}% — within the {MOISTURE_REJECTION_THRESHOLD}% limit."
    over = moisture_pct - MOISTURE_REJECTION_THRESHOLD
    risk = min(0.95, 0.3 + over * 0.15)
    return risk, f"Moisture {moisture_pct}% — {over:.1f}pt over limit. Dry before travelling."


# ---------------------------------------------------------------------------
# Notification ladder (README §10, §15) — one port (`send(recipient, message)
# -> bool`), several channels tried in order, every attempt logged so the
# officer dashboard can show exactly which channel actually reached a farmer.
#
# push:     stands in for FCM (no VAPID keys wired up in this dev build —
#           console is the honest placeholder for "delivered to the device").
# whatsapp: mocked unless WHATSAPP_TOKEN is set — same shape a real Cloud API
#           call would have, so wiring the real one later is a body-swap.
# email:    genuinely sends if SMTP_* env vars are set (free tier — Brevo/
#           Resend/Gmail SMTP, see README §15), else logs and reports success
#           so the ladder doesn't stall on a channel nobody's configured yet.
# sms:      always mocked — this is the tier README §15 says a state's DLT
#           gateway plugs into later. It logs, but reports delivered=False,
#           because claiming a message *was* delivered by SMS when it wasn't
#           would defeat the whole point of the dashboard showing this.
# ---------------------------------------------------------------------------

def _send_push(recipient: str, message: str) -> bool:
    print(f"[push] to farmer {recipient}: {message}")
    return True  # ponytail: real push needs FCM/VAPID keys; wire in app/main.py once available


def _send_whatsapp(recipient: str, message: str) -> bool:
    token = os.environ.get("WHATSAPP_TOKEN")
    if not token:
        print(f"[whatsapp:mock, no WHATSAPP_TOKEN set] to {recipient}: {message}")
        return False
    print(f"[whatsapp] to {recipient}: {message}")  # ponytail: swap for a real Cloud API POST once token exists
    return True


def _send_email(recipient: str, message: str) -> bool:
    host = os.environ.get("SMTP_HOST")
    if not host or "@" not in recipient:
        print(f"[email:mock, no SMTP_HOST set] to {recipient}: {message}")
        return False
    try:
        msg = MIMEText(message)
        msg["Subject"] = "VAARI update"
        msg["From"] = os.environ.get("SMTP_FROM", "vaari@example.org")
        msg["To"] = recipient
        with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", 587))) as s:
            s.starttls()
            s.login(os.environ.get("SMTP_USER", ""), os.environ.get("SMTP_PASS", ""))
            s.send_message(msg)
        return True
    except Exception as e:
        print(f"[email] send failed, falling back: {e}")
        return False


def _send_sms(recipient: str, message: str) -> bool:
    # Always mocked — no DLT-registered gateway available to a student team.
    # README §15: production plugs a real gateway in here with zero other changes.
    print(f"[sms:mock — needs a state DLT gateway] to {recipient}: {message}")
    return False


CHANNELS = [
    ("push", _send_push),
    ("whatsapp", _send_whatsapp),
    ("email", _send_email),
    ("sms", _send_sms),
]


def notify(db: Session, booking: models.Booking, message: str):
    """Walk the ladder until one channel delivers; log every attempt (even
    the ones that don't) so the dashboard shows the real delivery picture."""
    recipient_email = f"{booking.farmer_id}@example.org"  # placeholder until real contact fields exist
    delivered_via = None
    for channel_name, sender in CHANNELS:
        recipient = recipient_email if channel_name == "email" else booking.farmer.phone
        delivered = sender(recipient, message)
        db.add(
            models.NotificationLog(
                booking_token=booking.token,
                channel=channel_name,
                recipient=recipient,
                message=message,
                delivered=delivered,
            )
        )
        if delivered and delivered_via is None:
            delivered_via = channel_name
    db.commit()
    return delivered_via


def notify_officer(db: Session, centre: models.Centre, message: str):
    """SLA-breach escalation target (README §12) — officers get email/console,
    not the farmer ladder; they're not offline in a field with no signal."""
    recipient = centre.officer_email or f"officer+{centre.id}@example.org"
    delivered = _send_email(recipient, message) or _send_push(recipient, message)
    db.add(
        models.NotificationLog(
            booking_token=None,
            channel="officer_escalation",
            recipient=recipient,
            message=message,
            delivered=delivered,
        )
    )
    db.commit()



def haversine_km(lat1, lon1, lat2, lon2) -> float:
    """Straight-line distance — good enough to rank nearby centres; road
    distance would need a routing API (real cost, real API key) for a
    precision this project doesn't need yet."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def find_alternatives(db: Session, centre: models.Centre, day, max_results: int = 3):
    """Cross-centre load balancing (README §5, §17 F9) — the piece that
    actually *reduces* congestion district-wide rather than just managing
    the queue at one centre. Ranks other centres by how empty they are
    today, then by distance, and returns the least-crowded nearby options."""
    others = db.query(models.Centre).filter(models.Centre.id != centre.id).all()
    results = []
    for other in others:
        cap_day = (
            db.query(models.CapacityDay)
            .filter(models.CapacityDay.centre_id == other.id, models.CapacityDay.day == day)
            .first()
        )
        if not cap_day or cap_day.computed_capacity <= 0:
            continue
        booked = (
            db.query(models.Booking)
            .filter(
                models.Booking.centre_id == other.id,
                models.Booking.day == day,
                models.Booking.state != "released",
            )
            .count()
        )
        ratio = booked / cap_day.computed_capacity
        if ratio >= 0.9:
            continue  # no point suggesting a centre that's about to jam too
        results.append(
            {
                "centre_id": other.id,
                "name": other.name,
                "distance_km": round(haversine_km(centre.lat, centre.lon, other.lat, other.lon), 1),
                "computed_capacity": cap_day.computed_capacity,
                "booked": booked,
                "free": cap_day.computed_capacity - booked,
                "ratio": round(ratio, 2),
            }
        )
    results.sort(key=lambda r: (r["ratio"], r["distance_km"]))
    return results[:max_results]


def shift_downstream_etas(db: Session, centre_id: str, day, from_slot_start: datetime, actual_delay_minutes: float):
    """A booking runs `actual_delay_minutes` late -> if that's material, push
    every later booking today at this centre and notify them (README §9)."""
    if actual_delay_minutes < MATERIAL_ETA_SHIFT_MINUTES:
        return []
    affected = (
        db.query(models.Booking)
        .filter(
            models.Booking.centre_id == centre_id,
            models.Booking.day == day,
            models.Booking.slot_start >= from_slot_start,
            models.Booking.state.in_(["booked", "watching", "activated"]),
        )
        .all()
    )
    for b in affected:
        b.predicted_eta = b.predicted_eta + timedelta(minutes=actual_delay_minutes)
        db.add(b)
        notify(
            db,
            b,
            f"Your VAARI slot at {b.centre.name} has moved to "
            f"{b.predicted_eta.strftime('%H:%M')}. No need to leave home yet.",
        )
    db.commit()
    return [b.token for b in affected]
