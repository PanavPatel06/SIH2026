"""Demo data matching the Sehore-3 / Ramesh example in README §2, §8.
Run: python -m app.seed
"""
from datetime import date, timedelta
from .db import Base, engine, SessionLocal
from . import models, logic, auth

Base.metadata.create_all(bind=engine)
db = SessionLocal()

if not db.query(models.Centre).first():
    centre = models.Centre(
        name="Sehore-3", lat=23.2, lon=77.08, weighbridges=1, efficiency_factor=0.85,
        officer_email="district.officer@example.org",
    )
    db.add(centre)
    db.commit()
    db.refresh(centre)

    today = date.today()
    cap, factor = logic.compute_capacity(centre, gunny_bags=2350, labour_gangs=3, trucks_confirmed=2)
    cap_day = models.CapacityDay(
        centre_id=centre.id, day=today,
        gunny_bags=2350, labour_gangs=3, trucks_confirmed=2,
        computed_capacity=cap, limiting_factor=factor,
    )
    db.add(cap_day)

    # Demo accounts — created directly (an admin would do the same via DB/console
    # access), bypassing the OFFICER_SIGNUP_CODE gate self-serve signup uses.
    farmer = models.Farmer(
        name="Ramesh", phone="9800000001", village="Budhni", pin_hash=auth.hash_secret("1234"),
    )
    officer = models.Officer(
        email="officer@sehore3.example.org", password_hash=auth.hash_secret("demo1234"), centre_id=centre.id,
    )
    db.add(farmer)
    db.add(officer)
    db.commit()

    print(f"Seeded centre '{centre.name}' (id={centre.id}), capacity today = {cap} "
          f"(limiting factor: {factor}), farmer id={farmer.id}")
    print("Demo farmer login:  phone 9800000001 / PIN 1234")
    print("Demo officer login: officer@sehore3.example.org / demo1234")
else:
    print("Already seeded — skipping.")

db.close()
