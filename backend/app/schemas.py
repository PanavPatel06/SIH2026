from datetime import date, datetime
from pydantic import BaseModel


class FarmerIn(BaseModel):
    name: str
    phone: str
    village: str = ""


class FarmerOut(FarmerIn):
    id: str
    class Config:
        from_attributes = True


class FarmerRegisterIn(FarmerIn):
    pin: str  # 4+ digit PIN, not an OTP — see app/auth.py


class FarmerLoginIn(BaseModel):
    phone: str
    pin: str


class OfficerRegisterIn(BaseModel):
    email: str
    password: str
    centre_id: str  # self-serve signup always joins one centre; admins are seeded, not self-signed-up
    signup_code: str


class OfficerLoginIn(BaseModel):
    email: str
    password: str


class OfficerOut(BaseModel):
    id: str
    email: str
    centre_id: str | None
    class Config:
        from_attributes = True


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CentreIn(BaseModel):
    name: str
    lat: float
    lon: float
    weighbridges: int = 1
    efficiency_factor: float = 1.0
    officer_email: str = ""


class CentreOut(CentreIn):
    id: str
    class Config:
        from_attributes = True


class CapacityIn(BaseModel):
    day: date
    gunny_bags: int
    labour_gangs: int
    trucks_confirmed: int


class CapacityOut(BaseModel):
    day: date
    gunny_bags: int
    labour_gangs: int
    trucks_confirmed: int
    computed_capacity: int
    limiting_factor: str
    class Config:
        from_attributes = True


class BookingIn(BaseModel):
    # farmer_id deliberately absent — it comes from the auth token
    # (app/auth.py's get_current_farmer), never a client-supplied field,
    # so a farmer can only ever book for themselves.
    centre_id: str
    day: date
    quantity_quintals: float = 0
    moisture_pct: float | None = None


class BookingOut(BaseModel):
    token: str
    farmer_id: str
    centre_id: str
    day: date
    slot_start: datetime
    queue_position: int
    predicted_eta: datetime
    state: str
    moisture_pct: float | None
    quantity_quintals: float
    class Config:
        from_attributes = True


class CheckinIn(BaseModel):
    actual_time: datetime | None = None


class AdvancePaymentIn(BaseModel):
    stage: str
