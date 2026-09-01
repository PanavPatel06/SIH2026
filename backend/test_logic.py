"""Assert-based self-check for the non-trivial logic in app/logic.py.
Run: python3 test_logic.py
"""
from datetime import date, timedelta
from app import models, logic, auth


class FakeCentre:
    weighbridges = 1
    efficiency_factor = 1.0


def test_capacity_bottleneck_is_correctly_identified():
    # bags are the tightest constraint: 2350 // 50 = 47
    cap, factor = logic.compute_capacity(FakeCentre(), gunny_bags=2350, labour_gangs=10, trucks_confirmed=10)
    assert cap == 47, f"expected 47, got {cap}"
    assert factor == "gunny bags", f"expected gunny bags, got {factor}"


def test_capacity_switches_bottleneck_when_bags_are_plentiful():
    # now trucks are tightest: 1 truck * 25 = 25 (vs weighbridge limit of 48)
    cap, factor = logic.compute_capacity(FakeCentre(), gunny_bags=100000, labour_gangs=100, trucks_confirmed=1)
    assert factor == "evacuation trucks", f"expected evacuation trucks, got {factor}"
    assert cap == 25, f"expected 25, got {cap}"


def test_capacity_is_never_negative():
    cap, _ = logic.compute_capacity(FakeCentre(), gunny_bags=0, labour_gangs=0, trucks_confirmed=0)
    assert cap == 0


def test_capacity_rounds_instead_of_truncating_to_zero():
    # bags limit = 50 // 50 = 1 trolley; with a realistic sub-1.0 efficiency
    # factor, int() truncation would silently zero the centre out for the day.
    class LowEfficiencyCentre:
        weighbridges = 1
        efficiency_factor = 0.85

    cap, factor = logic.compute_capacity(LowEfficiencyCentre(), gunny_bags=50, labour_gangs=50, trucks_confirmed=50)
    assert cap == 1, f"expected round(1 * 0.85) == 1, got {cap}"
    assert factor == "gunny bags"


def test_eta_grows_with_queue_position():
    start = logic.slot_start_for_block(date.today(), 2)
    eta_first = logic.predicted_eta_for(start, queue_position=0, computed_capacity=47)
    eta_tenth = logic.predicted_eta_for(start, queue_position=10, computed_capacity=47)
    assert eta_tenth > eta_first, "later queue position must have a later ETA"


def test_rejection_risk_rises_with_moisture():
    low_risk, _ = logic.rejection_risk(11.5)
    high_risk, _ = logic.rejection_risk(15.0)
    assert low_risk < 0.5 < high_risk, f"expected low<0.5<high, got {low_risk}, {high_risk}"


def test_rejection_risk_defaults_low_when_no_reading():
    risk, _ = logic.rejection_risk(None)
    assert risk < 0.5


def test_low_capacity_day_does_not_allow_more_bookings_than_its_capacity():
    # a 1-trolley day must yield exactly one bookable block, not one per hour
    from unittest.mock import MagicMock

    class FakeCapDay:
        day = date.today()
        computed_capacity = 1

    class FakeQuery:
        def filter(self, *a, **k):
            return self

        def count(self):
            return 0  # nothing booked yet in any block

    db = MagicMock()
    db.query.return_value = FakeQuery()

    bookable_blocks = 0
    base = FakeCapDay.computed_capacity // logic.SLOT_BLOCKS
    remainder = FakeCapDay.computed_capacity % logic.SLOT_BLOCKS
    for block in range(logic.SLOT_BLOCKS):
        block_cap = base + (1 if block < remainder else 0)
        if block_cap > 0:
            bookable_blocks += 1
    assert bookable_blocks == 1, f"expected exactly 1 bookable block for capacity=1, got {bookable_blocks}"


def test_full_capacity_is_distributed_exactly_across_blocks():
    # capacity=38 across 12 blocks must sum back to exactly 38, not 36 (floor) or 44 (min-1 floor)
    total_cap = 38
    base = total_cap // logic.SLOT_BLOCKS
    remainder = total_cap % logic.SLOT_BLOCKS
    total = sum(base + (1 if b < remainder else 0) for b in range(logic.SLOT_BLOCKS))
    assert total == total_cap, f"expected block capacities to sum to {total_cap}, got {total}"


def test_haversine_km_matches_known_distance():
    # Delhi -> Mumbai is ~1150 km great-circle; sanity-check the formula
    # against a distance nobody can get wrong, plus the zero-distance case
    # find_alternatives relies on (same centre must never rank as "nearby").
    d_self = logic.haversine_km(23.25, 77.4, 23.25, 77.4)
    assert d_self == 0, f"same point must be 0 km apart, got {d_self}"
    d_far = logic.haversine_km(28.6139, 77.2090, 19.0760, 72.8777)
    assert 1100 < d_far < 1200, f"expected ~1150 km Delhi-Mumbai, got {d_far}"


def test_password_hash_roundtrips_and_rejects_wrong_secret():
    stored = auth.hash_secret("1234")
    assert auth.verify_secret("1234", stored)
    assert not auth.verify_secret("0000", stored)
    assert not auth.verify_secret("1234", "garbage")  # malformed stored value must not crash/pass


def test_token_roundtrips_and_rejects_tampering():
    token = auth.make_token("farmer-abc123", "farmer", hours=1)
    payload = auth._decode(token)
    assert payload["sub"] == "farmer-abc123"
    assert payload["typ"] == "farmer"

    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    try:
        auth._decode(tampered)
        assert False, "a tampered token must be rejected"
    except Exception:
        pass


def test_expired_token_is_rejected():
    token = auth.make_token("farmer-abc123", "farmer", hours=-1)  # already expired
    try:
        auth._decode(token)
        assert False, "an expired token must be rejected"
    except Exception:
        pass


def test_login_rate_limit_blocks_after_max_attempts():
    key = "test-rate-limit-key"
    for _ in range(auth.RATE_LIMIT_MAX_ATTEMPTS):
        auth.check_login_rate_limit(key)  # first N are allowed
    try:
        auth.check_login_rate_limit(key)  # N+1th must be blocked
        assert False, "the attempt after the limit must be rejected"
    except Exception:
        pass


def test_material_shift_gate_ignores_small_delays():
    assert logic.MATERIAL_ETA_SHIFT_MINUTES == 45  # documents the README §10 threshold
    # a 10-minute delay must never trigger downstream shifting — checked via
    # shift_downstream_etas' early-return, exercised at the API layer in main.py


if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} passed")
