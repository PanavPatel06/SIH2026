"""Data model — mirrors the ER diagram in README §13, trimmed to what Phase 1 needs.
Payment stages and notification log are separate tables rather than enums-on-booking
so each stage keeps its own timestamp (needed for the SLA tracker in §12)."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Integer, DateTime, ForeignKey, Boolean, Date
from sqlalchemy.orm import relationship
from .db import Base


def now():
    return datetime.now(timezone.utc)


def short_id():
    return uuid.uuid4().hex[:8]


class Farmer(Base):
    __tablename__ = "farmers"
    id = Column(String, primary_key=True, default=short_id)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False, unique=True)
    village = Column(String, default="")
    pin_hash = Column(String, nullable=False)  # see app/auth.py — phone + PIN login, no OTP
    created_at = Column(DateTime, default=now)

    bookings = relationship("Booking", back_populates="farmer")


class Officer(Base):
    """District/centre staff login. centre_id=None means a district admin
    (can act on any centre); set means scoped to that one centre only —
    enforced in app/auth.py's require_centre_access, not just at the UI."""
    __tablename__ = "officers"
    id = Column(String, primary_key=True, default=short_id)
    email = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    centre_id = Column(String, ForeignKey("centres.id"), nullable=True)
    created_at = Column(DateTime, default=now)


class Centre(Base):
    __tablename__ = "centres"
    id = Column(String, primary_key=True, default=short_id)
    name = Column(String, nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    weighbridges = Column(Integer, default=1)
    # calibration knob — real centres never match the paper model (README §8)
    efficiency_factor = Column(Float, default=1.0)
    officer_email = Column(String, default="")

    capacity_days = relationship("CapacityDay", back_populates="centre")


class CapacityDay(Base):
    """One row per centre per day — the inputs an officer logs each morning
    and the capacity the Capacity Engine derives from them (README §8)."""
    __tablename__ = "capacity_days"
    id = Column(String, primary_key=True, default=short_id)
    centre_id = Column(String, ForeignKey("centres.id"), nullable=False)
    day = Column(Date, nullable=False)

    gunny_bags = Column(Integer, default=0)
    labour_gangs = Column(Integer, default=0)
    trucks_confirmed = Column(Integer, default=0)

    computed_capacity = Column(Integer, default=0)
    limiting_factor = Column(String, default="")

    centre = relationship("Centre", back_populates="capacity_days")


class Booking(Base):
    """A farmer's token for one day at one centre. `predicted_eta` is recomputed
    live as the queue moves (README §7/§9) — this row is the single source of
    truth the farmer app polls or gets pushed against."""
    __tablename__ = "bookings"
    token = Column(String, primary_key=True, default=lambda: "VAR-" + short_id().upper())
    farmer_id = Column(String, ForeignKey("farmers.id"), nullable=False)
    centre_id = Column(String, ForeignKey("centres.id"), nullable=False)
    day = Column(Date, nullable=False)

    slot_start = Column(DateTime, nullable=False)
    queue_position = Column(Integer, nullable=False)
    predicted_eta = Column(DateTime, nullable=False)

    # booked -> activated (geofence, mocked here) -> checked_in -> weighed -> done | deferred | released
    # ponytail: state lives in the same table as everything else — no Redis.
    # Fine up to ~200 scans/hour per centre; move to a live queue store past that (README §15).
    state = Column(String, default="booked")
    moisture_pct = Column(Float, nullable=True)
    quantity_quintals = Column(Float, default=0)

    created_at = Column(DateTime, default=now)

    farmer = relationship("Farmer", back_populates="bookings")
    centre = relationship("Centre")
    payment_stages = relationship("PaymentStage", back_populates="booking")


# stage name -> SLA hours to reach it, per README §12
PAYMENT_STAGES = [
    ("weighed", 0),
    ("jform_issued", 24),
    ("uploaded_to_portal", 48),
    ("payment_advised", 72),
    ("dbt_credited", 168),
]


class PaymentStage(Base):
    __tablename__ = "payment_stages"
    id = Column(String, primary_key=True, default=short_id)
    booking_token = Column(String, ForeignKey("bookings.token"), nullable=False)
    stage = Column(String, nullable=False)
    entered_at = Column(DateTime, default=now)
    sla_hours = Column(Integer, default=0)
    escalated = Column(Boolean, default=False)  # dedupe: don't re-email on every poll once breached

    booking = relationship("Booking", back_populates="payment_stages")


class NotificationLog(Base):
    """Every send attempt, in ladder order, so a demo (or an officer) can see
    exactly which channel a farmer was actually reached on (README §10)."""
    __tablename__ = "notification_log"
    id = Column(String, primary_key=True, default=short_id)
    booking_token = Column(String, ForeignKey("bookings.token"), nullable=True)
    channel = Column(String, nullable=False)
    recipient = Column(String, default="")
    message = Column(String, nullable=False)
    delivered = Column(Boolean, default=True)
    sent_at = Column(DateTime, default=now)
