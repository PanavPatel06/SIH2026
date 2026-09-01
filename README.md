# VAARI — *"Your turn. On time."*

> **SIH 2026 · Problem Statement 26032**
> Ministry of Consumer Affairs, Food & Public Distribution · Department of Consumer Affairs (DoCA)
> Theme: Smart Automation · Category: Software

*`vaari` (वारी / ਵਾਰੀ) — "one's turn" in the Hindi–Punjabi wheat belt.*

---

## 1. The one-line difference

> **Every other team will build a system that tells farmers when to come.
> We build the one that tells them when *not* to come.**

The queue at a procurement centre is not caused by missing software. It is caused by **distrust**. Farmers arrive at 5 AM *because the system is unpredictable* — which is precisely what makes it unpredictable. Hand them a booking app and they will book a slot **and still show up at 5 AM.**

VAARI attacks the distrust, not the form-filling.

---

## 2. The problem, concretely

**Ramesh — Sehore district, MP. 40 quintals of wheat. Rabi season.**

| Day | What happens | Cost to Ramesh |
|-----|--------------|----------------|
| 1 | Hears from a neighbour the centre is buying. No official schedule reached him. Rents a tractor-trolley, drives 18 km at 5 AM. Finds 60 trolleys already queued. Gunny bags ran out at noon. | ₹1,500 rent |
| 2 | Sleeps beside his trolley in the yard. | ₹1,500 rent |
| 3 | Weighed at last. Moisture reads 13.5% against a 12% cap. **Rejected.** Told to dry it and return. | ₹1,500 rent, ₹0 earned |
| 8 | Returns. Sells. Receives a paper J-form. | — |
| 8 → ? | *When does the money arrive?* Nobody can say. Some neighbours were paid in 8 days, some in 6 weeks. His loan instalment is due. | Sleepless |

Multiply by 300 farmers at one centre. Three failures compound:

```mermaid
flowchart LR
    A["No trustworthy<br/>schedule"] --> B["Everyone arrives<br/>at dawn"]
    B --> C["Yard jams,<br/>throughput drops"]
    C --> D["Waits grow<br/>unpredictable"]
    D --> A
    C --> E["Wasted trips<br/>on rejection"]
    D --> F["No payment<br/>visibility"]

    style A fill:#fde2e2,stroke:#c0392b
    style C fill:#fde2e2,stroke:#c0392b
    style D fill:#fde2e2,stroke:#c0392b
```

**It is a feedback loop.** Break the loop at one point and the whole thing unwinds.

---

## 3. Why existing systems don't already solve this

Several states run procurement portals today:

| State | System | What it does | What it does **not** do |
|---|---|---|---|
| Madhya Pradesh | e-Uparjan | Registration, SMS with date + centre | React when the day goes wrong |
| Punjab | Anaj Kharid | Registration, J-form, payment records | Tell a farmer to stay home |
| Haryana | Meri Fasal Mera Byora | Registration, slot/date allocation | Model actual centre capacity |

> ⚠️ **Verify each portal's current feature set before pitching.** A judge from DoCA will know them. You must be able to name them and say precisely what they lack.

They are **registration systems** — one-way, static, *"here is your date, good luck."*
VAARI is a **live operations system** — two-way, dynamic, capacity-modelled, and honest when it slips.

That distinction is the entire project.

---

## 4. Our answer: one causal chain, not a feature list

```mermaid
flowchart LR
    T["① Radical capacity<br/>transparency"] --> TR["Farmer believes<br/>the number"]
    TR --> VQ["② Virtual queue<br/>is actually obeyed"]
    TR --> AI["③ On-device advisor<br/>is actually followed"]
    VQ --> NS["No dawn stampede"]
    AI --> NW["No wasted trips"]
    NS --> W["⏱ Waiting time<br/>collapses"]
    NW --> W
    W --> P["④ Payment tracker<br/>closes the loop"]

    style T fill:#e8f5e9,stroke:#2e7d32
    style VQ fill:#e8f5e9,stroke:#2e7d32
    style AI fill:#e8f5e9,stroke:#2e7d32
    style P fill:#e8f5e9,stroke:#2e7d32
    style W fill:#fff3e0,stroke:#ef6c00
```

Each piece **needs** the others. A feature list can be copied in a weekend. A mechanism has to be understood.

---

## 5. Features, mapped to the problem statement

| PS requirement | VAARI feature | What makes it different |
|---|---|---|
| Farmer registration & slot booking | **Capacity-aware Slot Engine** | Slots derived from real constraints — gunny bags, weighbridges, labour, evacuation trucks — not a fixed number. Overbooking is impossible by construction. |
| Real-time queue management | **Virtual Queue + Live ETA** | Position is held *while you wait at home*. Geofence activates your token within 10 km. Arriving early gains you nothing — and the app says so. |
| SMS / app notifications | **Notification Ladder** | Push → WhatsApp → email → SMS → IVR. Free channels carry the pilot; the SMS port is built and ready for the state's DLT gateway. |
| Track procurement & payment status | **Payment Pipeline Tracker** | Five explicit stages, each timestamped, each with an SLA. Breach auto-escalates to the district officer. |
| Reduce congestion & waiting time | **Trip-Saver Advisor (on-device AI)** | Predicts rejection risk *before the trolley is loaded*, and recommends the slot with the lowest total cost to the farmer. Runs with **zero network**. |
| *(beyond the PS)* | **Cross-centre load balancing** | Centre A backed up 3 days, Centre B idle 9 km away → offer the swap. This is what actually *reduces* congestion district-wide. |
| *(beyond the PS)* | **Officer Operations Dashboard** | Live backlog heatmap, bag stock, evacuation lag. Fix the jam *before* it happens. |

---

## 6. System architecture

```mermaid
flowchart TB
    subgraph CL["🧑‍🌾 CLIENT LAYER"]
        direction LR
        APP["Farmer App<br/>Android · offline-first"]
        SMS["SMS / IVR<br/>feature phones"]
        MAIL["Email / WhatsApp<br/>officers + farmers"]
        GATE["Gate Operator App<br/>offline QR scan"]
        DASH["Officer Dashboard<br/>web"]
    end

    subgraph EDGE["🚪 EDGE LAYER"]
        direction LR
        GW["API Gateway<br/>auth · rate limit"]
        SYNC["Delta Sync Service<br/>tiny payloads for 2G"]
        SMSGW["Notification Gateway<br/>push · WhatsApp · email · SMS"]
    end

    subgraph CORE["⚙️ CORE SERVICES"]
        direction LR
        ID["Identity<br/>& Registration"]
        CAP["Capacity<br/>Engine"]
        SLOT["Slot<br/>Engine"]
        QUEUE["Queue<br/>Engine"]
        NOTIF["Notification<br/>Orchestrator"]
        PAY["Payment<br/>Tracker"]
        ADV["Advisory<br/>ML Service"]
    end

    subgraph DATA["🗄 DATA LAYER"]
        direction LR
        PG[("PostgreSQL<br/>transactional")]
        RD[("Redis<br/>live queue state")]
        WH[("Warehouse<br/>training data")]
        OBJ[("Object Store<br/>J-forms, docs")]
    end

    subgraph EXT["🔌 EXTERNAL"]
        direction LR
        STATE["State Portal<br/>e-Uparjan / Anaj Kharid"]
        PFMS["PFMS / DBT<br/>payment rails"]
        WX["Weather API"]
    end

    APP --> GW
    GATE --> GW
    DASH --> GW
    SMS --> SMSGW
    MAIL --> SMSGW
    APP <-.delta.-> SYNC

    GW --> ID & SLOT & QUEUE & PAY
    SYNC --> SLOT & QUEUE & ADV
    SMSGW --> NOTIF

    CAP --> SLOT
    SLOT --> QUEUE
    QUEUE --> NOTIF
    ADV --> SLOT
    NOTIF --> SMSGW

    ID & SLOT & PAY --> PG
    QUEUE --> RD
    ADV --> WH
    PAY --> OBJ

    PAY <--> PFMS
    ID <--> STATE
    ADV <--> WX

    style CL fill:#e3f2fd,stroke:#1565c0
    style EDGE fill:#f3e5f5,stroke:#6a1b9a
    style CORE fill:#e8f5e9,stroke:#2e7d32
    style DATA fill:#fff3e0,stroke:#ef6c00
    style EXT fill:#eceff1,stroke:#455a64
```

---

## 7. How it works — the farmer's journey

```mermaid
sequenceDiagram
    autonumber
    actor F as 🧑‍🌾 Ramesh
    participant A as 📱 App (offline-capable)
    participant S as Slot Engine
    participant C as Capacity Engine
    participant Q as Queue Engine
    participant N as Notification Orchestrator
    participant G as 🚪 Gate Operator

    Note over C: 05:00 — daily capacity recompute
    C->>C: bags + weighbridges + labour + trucks<br/>→ 47 trolleys today
    C->>S: publish capacity + the reasons why

    F->>A: "I have 40 qtl wheat, ready"
    A->>A: 🤖 ON-DEVICE: score slots<br/>(works with zero network)
    A-->>F: "Thu 11 AM · wait ~35 min · rejection risk 12%<br/>⚠ Today: 68% risk — grain too wet"
    F->>A: Book Thursday 11 AM
    A->>S: reserve slot
    S-->>A: ✅ token VAR-8842 + offline QR

    Note over Q: Thursday — centre falls 90 min behind
    Q->>N: ETA shift +90 min (material)
    N-->>A: 🔔 push: "New ETA 12:30. Leave by 11:45."
    N-->>F: 📩 WhatsApp / email fallback if push not ACKed<br/>(SMS port ready for state DLT gateway)
    Note over F: Still at home. Re-plans. Zero cost.

    F->>F: 🚜 Leaves at 11:45
    Note over A: enters 10 km geofence → token auto-activates
    A->>Q: activate VAR-8842
    Q-->>A: "You are #3. Direct to Lane 2."

    F->>G: arrives, shows QR
    G->>G: scan works OFFLINE, syncs later
    G->>Q: checked in → weigh → grade → accept
    Q->>N: sold ✅ → payment pipeline starts
```

**The moment that matters is step 12–14.** Ramesh learns about the delay *while still at home*. That single interaction is the whole product.

---

## 8. Deep dive ① — Capacity-Aware Slot Engine

Most systems publish a fixed number of slots. Reality doesn't care about fixed numbers.

```mermaid
flowchart LR
    subgraph IN["Real constraints, entered daily"]
        B["🧺 Gunny bags<br/>in stock"]
        W["⚖️ Weighbridges<br/>× avg weigh time"]
        L["👷 Labour gangs<br/>present"]
        T["🚛 Evacuation trucks<br/>confirmed"]
        Y["🅿️ Yard space<br/>free"]
    end

    B & W & L & T & Y --> MIN["Bottleneck =<br/>MIN of all limits"]
    MIN --> HIST["× centre efficiency factor<br/>learned from history"]
    HIST --> N["📋 47 trolleys today"]
    N --> PUB["📢 Published WITH reasons"]

    style MIN fill:#fff3e0,stroke:#ef6c00
    style PUB fill:#e8f5e9,stroke:#2e7d32
```

**Radical transparency is the feature.** The app doesn't say *"47 slots."* It says:

> **Centre Sehore-3 — 47 trolleys today**
> 3,400 gunny bags in stock · 1 weighbridge · 2 evacuation trucks confirmed
> *Limiting factor: gunny bags*

Nobody publishes this. It is exactly what makes a farmer believe the number — and belief is what makes the virtual queue work.

It also turns the officer dashboard into a real tool: the officer sees `limiting factor: gunny bags` **three days before** the yard jams.

> 📌 The `efficiency factor` is a calibration knob per centre, seeded at 1.0 and learned from actual vs. predicted throughput. Real centres are never the ideal on paper.

---

## 9. Deep dive ② — Virtual Queue & Live ETA

```mermaid
stateDiagram-v2
    [*] --> Booked: farmer reserves slot
    Booked --> Watching: T-minus 6 hours
    note right of Watching
        Farmer is AT HOME.
        Queue position held.
        ETA pushed on every change.
    end note

    Watching --> Rescheduled: centre slips > 45 min
    Rescheduled --> Watching: farmer accepts new ETA
    Rescheduled --> Released: farmer can't make it
    Released --> [*]: slot freed for someone else

    Watching --> Activated: enters 10 km geofence
    Activated --> AtGate: QR scanned
    AtGate --> Weighing
    Weighing --> Graded
    Graded --> Accepted: within moisture / FAQ limits
    Graded --> Deferred: rejected → auto-rebook offered
    Deferred --> Booked
    Accepted --> [*]: payment pipeline begins
```

**Design rules that make this actually work:**

1. **Presence ≠ position.** Arriving at 5 AM changes nothing. The app states this plainly on the booking screen.
2. **Geofencing is client-side** (Android Geofencing API) — needs **no network** to fire.
3. **Released slots recirculate.** Ramesh can't come → someone 8 km away gets an SMS offering it.
4. **A rejection auto-offers a rebook**, so a bad day never becomes a lost sale.

---

## 10. Deep dive ③ — Offline-first & the notification ladder

> *"It should work under less network as farmers live in remote areas."*

This is a **hard architectural constraint**, not a nice-to-have. Everything below follows from it.

### The delivery ladder

```mermaid
flowchart TD
    CH["📣 ETA / schedule change"] --> MAT{"Material?<br/>shift > 45 min"}
    MAT -->|no| LOG["Log only.<br/>Sync on next app open."]
    MAT -->|yes| P

    subgraph FREE["💰 ₹0 TIERS — but every one of them needs data"]
        direction TB
        P["① FCM push<br/>free, unlimited"] -->|"no ACK in 10 min"| W
        W["② WhatsApp Cloud API<br/>free tier · best rural reach"] -->|"not delivered"| E
        E["③ Email<br/>free · also the officer channel"]
    end

    E -->|"not opened in 20 min"| S

    subgraph NODATA["📡 NO-DATA TIER — the one that reaches a feature phone"]
        direction TB
        S["④ SMS adapter<br/>interface built · mocked in pilot<br/>state plugs in its DLT gateway"] -->|"unavailable"| I
        I["⑤ IVR / FPO kiosk<br/>Phase 3"]
    end

    style FREE fill:#e8f5e9,stroke:#2e7d32
    style NODATA fill:#fff3e0,stroke:#ef6c00
```

### The channels, honestly

| Tier | Channel | Cost | Needs data? | Reaches | Role |
|---|---|---|---|---|---|
| ① | **FCM push** | **Free, unlimited** | ✅ yes | Smartphone users with our app | Primary |
| ② | **WhatsApp Cloud API** | Free tier *(verify current terms)* | ✅ yes | Very wide rural India penetration | **The realistic farmer channel** |
| ③ | **Email** | Free *(Brevo / Resend / SMTP)* | ✅ yes | Officers always; farmers sometimes | **Officer + audit channel**, farmer fallback |
| ④ | **SMS** | Needs DLT + per-message | ❌ **no — 2G signal only** | **Everyone, including feature phones** | The tier that makes the ladder complete |
| ⑤ | **IVR / FPO kiosk** | Voice minutes | ❌ no | Non-readers, the fully disconnected | Phase 3 |

> ⚠️ **Be honest about this trade-off — a judge will find it otherwise.**
> Tiers ①–③ are free, but **all three require a data connection.** SMS was special precisely because it needs *none*. Dropping it to save money would delete the ladder's whole reason for existing.
>
> **So we don't drop it — we build the interface and mock the sender.** Every channel implements one `NotificationChannel` port: `send(recipient, message) → DeliveryStatus`. The pilot ships ①–③ live and ④ as a mock that logs and shows in the dashboard. **The state plugs its existing DLT gateway into the same port with one adapter class and zero changes elsewhere.**
>
> Say this out loud in the pitch: *"We built the no-data tier as an interface, not a stub, because we didn't have DLT access. The state does."* That converts a budget constraint into evidence of good design.

**Why the `Material?` gate exists:** notifications cost money at national scale — SMS especially. Gating on a 45-minute threshold cuts volume by an estimated order of magnitude while never hiding a change the farmer would act on. *(Threshold is configurable per state and should be tuned on pilot data.)*

### What the app does with zero network

| Capability | Works offline? | How |
|---|---|---|
| View my token + QR | ✅ | QR encodes a signed payload; verifiable offline by the gate app |
| See last-known ETA | ✅ | Cached, stamped **"as of 3 hours ago"** — never shown as fresh |
| Get slot recommendations | ✅ | On-device model — see §11 |
| Check rejection risk | ✅ | On-device model + cached weather |
| Book a slot | ⏳ | Queued locally, submitted on reconnect, confirmed by SMS |
| Payment status | ⏳ | Last synced value + timestamp |

### Sync design for 2G

```mermaid
flowchart LR
    subgraph PHONE["📱 Device"]
        RM[("Room DB<br/>local truth")]
        WM["WorkManager<br/>retry + backoff"]
        OUT["Outbox<br/>pending actions"]
    end

    subgraph SERVER["☁️ Server"]
        SV["Delta Sync API"]
        VC["Version cursor<br/>per device"]
    end

    RM --> WM
    OUT --> WM
    WM -->|"cursor + outbox<br/>~2 KB"| SV
    SV --> VC
    VC -->|"only what changed<br/>~1–5 KB"| WM
    WM --> RM

    style PHONE fill:#e3f2fd,stroke:#1565c0
    style SERVER fill:#e8f5e9,stroke:#2e7d32
```

- **Delta sync, never full sync.** Device sends a version cursor; server returns only changes. Typical payload **1–5 KB** — completes on EDGE.
- **Local-first writes.** Every action lands in Room immediately, then an outbox drains via WorkManager with exponential backoff. The UI never blocks on the network.
- **Conflict rule:** server wins on slot allocation *(it owns scarce capacity)*; device wins on farmer preferences. Simple, predictable, no merge algebra.
- **Freshness is always visible.** Every cached screen carries *"as of HH:MM"*. A system that lies once about staleness is never trusted again.

---

## 11. Deep dive ④ — On-device AI advisor

> *"AI recommendation for timings which can run or reside offline."*

A large model on a ₹6,000 Android phone with no data connection is fantasy. Here is what actually works:

### Train in the cloud, score on the device

```mermaid
flowchart LR
    subgraph CLOUD["☁️ CLOUD — heavy, nightly"]
        H["Historical data<br/>all centres · all seasons"]
        WX2["Weather history"]
        TR["Train LightGBM<br/>wait-time + rejection-risk"]
        EX["Export per-centre<br/>coefficient profile"]
    end

    subgraph WIRE["📡 SYNC — tiny"]
        PROF["Centre Profile<br/>~4 KB each<br/>wait curve by day×hour,<br/>rejection thresholds,<br/>efficiency factor"]
    end

    subgraph DEVICE["📱 DEVICE — light, instant, offline"]
        ORT["ONNX Runtime Mobile<br/>~2 MB, quantised"]
        FEAT["Local features:<br/>crop · qty · distance ·<br/>cached weather · my history"]
        OUT2["🎯 Ranked slots<br/>+ predicted wait<br/>+ rejection risk<br/>+ ₹ cost estimate"]
    end

    H & WX2 --> TR --> EX --> PROF --> ORT
    FEAT --> ORT --> OUT2

    style CLOUD fill:#e8f5e9,stroke:#2e7d32
    style WIRE fill:#fff3e0,stroke:#ef6c00
    style DEVICE fill:#e3f2fd,stroke:#1565c0
```

**The key move:** we ship **coefficients, not models**. A per-centre profile is ~4 KB. A farmer's 3 nearest centres = ~12 KB, syncable over 2G in seconds. The phone runs inference locally in milliseconds.

Result: **a farmer with no network for three days still gets a defensible recommendation** — clearly labelled *"based on data from 3 days ago."*

### What the advisor actually predicts

| Model | Inputs | Output | Why it earns its place |
|---|---|---|---|
| **Wait-time** | day-of-week, hour, centre profile, current backlog (last synced), seasonal peak curve | *"~35 min wait"* | Turns a slot into a decision |
| **Rejection risk** | self/FPO moisture reading, rainfall in village last 72 h, crop variety, centre's historical rejection pattern | *"68% risk — dry 2 days"* | **A rejected trip costs ₹1,500–4,000.** This is the money feature. |
| **Best-slot ranker** | both of the above + distance + trolley rent + farmer's stated urgency | Ranked slots with a **₹ cost** on each | Optimises the farmer's real cost, not our queue |

### Graceful degradation — never a blank screen

```mermaid
flowchart TD
    Q["Farmer opens<br/>slot advisor"] --> N1{"Network?"}
    N1 -->|"online"| A1["🟢 Live model<br/>+ current backlog"]
    N1 -->|"offline,<br/>profile < 24 h"| A2["🟡 On-device model<br/>'as of 6 hours ago'"]
    N1 -->|"offline,<br/>profile stale"| A3["🟠 Historical average<br/>for this centre + weekday"]
    N1 -->|"no profile<br/>ever synced"| A4["⚪️ Published schedule only<br/>+ SMS a request for one"]

    style A1 fill:#e8f5e9,stroke:#2e7d32
    style A2 fill:#fff9c4,stroke:#f9a825
    style A3 fill:#ffe0b2,stroke:#ef6c00
    style A4 fill:#eceff1,stroke:#607d8b
```

> 📌 **The advisor never fabricates confidence.** Each tier is visually distinct and labelled. Trust is the product; an overconfident wrong ETA destroys more value than no ETA at all.

---

## 12. Deep dive ⑤ — Payment pipeline tracker

The problem statement's *"uncertainty about procurement status"* is half the ask — and the half most teams forget.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Weighed
    Weighed --> JFormIssued: SLA 1 day
    JFormIssued --> UploadedToPortal: SLA 2 days
    UploadedToPortal --> PaymentAdvised: SLA 3 days
    PaymentAdvised --> DBTCredited: SLA 7 days
    DBTCredited --> [*]

    Weighed --> Escalated: SLA breach
    JFormIssued --> Escalated: SLA breach
    UploadedToPortal --> Escalated: SLA breach
    PaymentAdvised --> Escalated: SLA breach
    Escalated --> PaymentAdvised: officer resolves
```

Every stage carries a **timestamp** and an **SLA**. On breach:

1. Farmer sees the stage stuck, with the reason and *who owns it*.
2. The district officer's dashboard raises it automatically.
3. No phone calls. No visits to the centre to ask "kab aayega paisa?"

> **SLA values above are illustrative** — set them from the actual state procurement policy you target.

---

## 13. Data flow, end to end

### The three loops

```mermaid
flowchart TB
    subgraph L1["🔄 LOOP 1 — DAILY CAPACITY  ·  every morning 05:00"]
        direction LR
        C1["Centre staff log<br/>bags, labour, trucks"] --> C2["Capacity Engine<br/>computes bottleneck"]
        C2 --> C3["Slots published<br/>+ the reasons"]
        C3 --> C4["Pushed to devices<br/>on next sync"]
    end

    subgraph L2["⚡ LOOP 2 — LIVE QUEUE  ·  seconds"]
        direction LR
        Q1["Gate scans QR"] --> Q2["Redis queue<br/>state updated"]
        Q2 --> Q3["ETAs recomputed<br/>for everyone downstream"]
        Q3 --> Q4["Material changes →<br/>notification ladder"]
    end

    subgraph L3["🧠 LOOP 3 — LEARNING  ·  nightly"]
        direction LR
        M1["Actual vs predicted<br/>waits + rejections"] --> M2["Warehouse"]
        M2 --> M3["Retrain models,<br/>recalibrate efficiency factor"]
        M3 --> M4["New 4 KB profiles<br/>→ devices"]
    end

    L1 --> L2 --> L3
    L3 -.improves.-> L1

    style L1 fill:#e8f5e9,stroke:#2e7d32
    style L2 fill:#e3f2fd,stroke:#1565c0
    style L3 fill:#fff3e0,stroke:#ef6c00
```

### Core data model

```mermaid
erDiagram
    FARMER ||--o{ BOOKING : makes
    FARMER ||--o{ LAND_RECORD : owns
    CENTRE ||--o{ CAPACITY_DAY : "publishes daily"
    CENTRE ||--o{ BOOKING : hosts
    CENTRE ||--|| CENTRE_PROFILE : "has ML profile"
    CAPACITY_DAY ||--o{ SLOT : "generates"
    SLOT ||--o| BOOKING : "reserved by"
    BOOKING ||--o| ARRIVAL : "checked in as"
    ARRIVAL ||--o| PROCUREMENT : "weighed into"
    PROCUREMENT ||--|| PAYMENT : triggers
    PROCUREMENT }o--|| COMMODITY : "of type"

    FARMER {
        uuid id PK
        string phone
        string state_farmer_id "link to e-Uparjan etc."
        point village_location
        string preferred_language
    }
    CENTRE {
        uuid id PK
        point location
        int weighbridges
        float efficiency_factor "calibration knob"
    }
    CAPACITY_DAY {
        date day
        int gunny_bags
        int labour_gangs
        int trucks_confirmed
        int computed_capacity
        string limiting_factor "published to farmers"
    }
    BOOKING {
        uuid token PK
        timestamp slot_start
        timestamp predicted_eta "recomputed live"
        string state "booked|watching|activated|done"
    }
    PAYMENT {
        string stage
        timestamp stage_entered_at
        boolean sla_breached
    }
    CENTRE_PROFILE {
        blob wait_curve "~4 KB, synced to device"
        float rejection_threshold
        date trained_on
    }
```

---

## 14. Tech stack

Deliberately boring. Boring survives a demo day and a government audit.

| Layer | Choice | Why |
|---|---|---|
| **Farmer app** | Kotlin + Jetpack Compose, **Room**, **WorkManager** | Room = offline truth; WorkManager = retry/backoff for free. Target **API 24+** — old phones are the actual user base. |
| **On-device ML** | **ONNX Runtime Mobile** (quantised) | ~2 MB, runs LightGBM exports. TFLite is the fallback if size becomes an issue. |
| **Backend** | **Python + FastAPI** | ML lives in the request path; keeping one language removes a whole class of glue. |
| **Transactional DB** | **PostgreSQL** | Slot allocation needs real transactions. Row-level locking prevents double-booking. Free via Supabase or Neon — see §15. |
| **Live queue state** | **Redis** *(Phase 2+)* | ETAs recompute constantly; durable truth stays in Postgres. **Cut from Phase 1** — Postgres handles pilot scale. See §15. |
| **Notifications** | FCM + WhatsApp Cloud API + email, behind one `NotificationChannel` port | All three are free. SMS/IVR implement the same port — **the state supplies the DLT gateway. See §15.** |
| **ML training** | LightGBM / scikit-learn → ONNX export | Tabular data. Gradient-boosted trees beat deep learning here and are far easier to explain to a judge. |
| **Officer dashboard** | React + Leaflet | Map-first — the officer thinks in geography. |
| **Deployment** | Docker + **NIC / MeghRaj** cloud | Government deployments favour NIC. Docker keeps it portable — and lets the pilot run on a ₹0 tier first. |

> **No blockchain. No LLM. No drones.** Every unrelated buzzword weakens the pitch — a judge who can say *"nice, but why?"* has stopped listening.

---

## 15. Building this for ₹0

**The good news: this architecture is already cheap by construction.**

| Design choice | Why it saves money |
|---|---|
| **Offline-first** | Fewer requests per farmer per day → stays inside free request quotas |
| **Delta sync (1–5 KB)** | Free tiers meter bandwidth. Tiny payloads barely register. |
| **On-device ML** | **No inference server at all.** Inference is the expensive part of ML hosting — we simply don't host it. |
| **Seasonal load** | ~245 days a year at near-zero traffic. Free tiers are sized for exactly this shape. |

We didn't design it this way to be cheap — we designed it for bad rural networks. Cheap is a side effect. **Say that in the pitch;** "our architecture costs nothing to run off-season" is a real argument to a ministry, not just a student's constraint.

### The ₹0 stack

> ⚠️ **Free tiers change constantly. Verify current terms before you commit** — this table reflects a snapshot, not a guarantee.

| Layer | Free choice | Limit | What breaks first |
|---|---|---|---|
| **Backend API** | **Oracle Cloud Always Free** ARM VM (4 cores / 24 GB, no time limit) | Always free, no expiry | ARM capacity is often unavailable at signup — retry, or fall back to Render |
| ↳ *fallback* | Render / Hugging Face Spaces free web service | Sleeps after ~15 min idle | **Cold start — see the demo trap below** |
| **Database** | **Supabase** free tier — Postgres + PostGIS + storage + auth | Pauses after ~1 week idle, restores on request | Row/storage caps; fine at pilot scale |
| ↳ *alternative* | **Neon** serverless Postgres | Generous free compute hours | Cold starts on first query |
| **Live queue state** | **Cut Redis entirely for Phase 1** | — | Nothing. See below. |
| **Push notifications** | **Firebase Cloud Messaging** | **Free, unlimited, forever** | Nothing. FCM has no paid tier for messaging. |
| **Email** | **Brevo** ~300/day, or **Resend** ~3,000/mo, or Gmail SMTP | Daily send caps | Caps are far above pilot volume |
| **WhatsApp** | **WhatsApp Cloud API** free service tier | Meta changes terms often | Verify before depending on it |
| **SMS** | **Mocked port** — state supplies the DLT gateway | n/a in pilot | Nothing. See below. |
| **Telegram** *(backup)* | Bot API — free, unlimited | None worth hitting | Nothing |
| **Weather data** | **Open-Meteo** | Free, **no API key, no signup** | Rate limits well above our needs |
| **Maps** | **Leaflet + OpenStreetMap** tiles | Free, no key | Heavy tile usage — fine for one district |
| **Officer dashboard hosting** | **Cloudflare Pages** or **Vercel** free tier | Generous for static + light API | Nothing at demo scale |
| **ML training** | **Your laptop.** LightGBM on tabular data trains in seconds. | — | Nothing. No GPU needed — this is not deep learning. |
| ↳ *if you want cloud* | Google Colab free tier | Session time limits | Irrelevant for tabular models |
| **App distribution** | **GitHub Releases** APK + QR code, or Firebase App Distribution | Free | Play Store costs **$25 one-time — skip it for SIH** |
| **CI/CD** | **GitHub Actions** | Free for public repos | Make the repo public — judges like that anyway |
| **Domain** | Free `*.vercel.app` / `*.pages.dev` subdomain | Free | Vanity only |
| **Keep-alive pings** | GitHub Actions scheduled workflow, or UptimeRobot free | Free | See demo trap |

**Total recurring cost: ₹0.**

### Two architecture changes ₹0 actually forces

**① Cut Redis for Phase 1.** It was a scale optimisation for thousands of concurrent gate scans. At pilot scale — one district, 50 centres — **Postgres handles live queue state fine.** Delete the dependency, delete the free-tier account, delete the failure mode.

> `ponytail:` queue state in Postgres, move to Redis when a single centre exceeds ~200 scans/hour or ETA recompute latency exceeds 2s.

Re-read §6: the architecture diagram survives this unchanged. Redis was always an implementation detail behind the Queue Engine, which is exactly why it's safe to drop.

**② SMS becomes a port, not a purchase.** The free channels — push, WhatsApp, email — carry the pilot. SMS keeps its place in the ladder as an interface with a mocked sender, so the state drops in its DLT gateway later with one adapter class. Detailed below.

> `ponytail:` SMS sender mocked; implement the real adapter when a DLT-registered gateway (or a spare phone + SIM) becomes available.

### The messaging problem — and the ₹0 answer

Messaging is the **only** genuinely expensive piece. Commercial Indian SMS needs **DLT registration**, which needs a registered business entity — a wall for a student team. And a phone-gateway workaround needs a spare phone and SIM you may not have.

**So the pilot runs on three free channels, and treats SMS as a port rather than a purchase.**

```mermaid
flowchart LR
    N["Notification<br/>Orchestrator"] --> PORT["NotificationChannel<br/>one interface"]
    PORT --> C1["📲 FCM push<br/>free"]
    PORT --> C2["💬 WhatsApp Cloud API<br/>free tier"]
    PORT --> C3["📧 Email<br/>free"]
    PORT -.->|"same port,<br/>one adapter class"| C4["📩 SMS via state DLT gateway<br/>mocked in pilot"]

    style C1 fill:#e8f5e9,stroke:#2e7d32
    style C2 fill:#e8f5e9,stroke:#2e7d32
    style C3 fill:#e8f5e9,stroke:#2e7d32
    style C4 fill:#eceff1,stroke:#607d8b,stroke-dasharray: 5 5
```

**Email — free options**

| Option | Free allowance *(verify current terms)* | Notes |
|---|---|---|
| **Brevo** *(ex-Sendinblue)* | ~300 emails/day | No card required. Good default. |
| **Resend** | ~3,000/month | Cleanest API, great developer experience |
| **Gmail SMTP** | ~500/day from a normal account | Zero setup; use a dedicated project account, **never a personal one** |
| **Mailgun / SendGrid** | Trial tiers | Verify current free terms before relying on them |

Email is not a compromise everywhere — **for the officer dashboard and SLA-breach escalations in §12, email is the *correct* channel.** District officers all have email; they don't want app notifications. Place it there deliberately and it stops looking like a workaround.

**WhatsApp — the one that actually reaches farmers**

WhatsApp has far deeper rural India penetration than email. **WhatsApp Cloud API** has a free service-conversation tier *(Meta has changed this pricing repeatedly — verify before you depend on it)*. Setup needs a Meta Business account and number verification, but **no spend**. If you get one channel working beyond push, make it this one.

**Telegram — the demo-proof backup**

Free, unlimited, no business account, working bot in ~20 minutes. Not realistic for farmers, but an excellent officer-alert channel and a guaranteed live fallback if WhatsApp verification stalls the week before your demo. Cheap insurance.

**If you *do* find a spare Android phone + SIM later**, an open-source SMS-gateway app turns it into a real SMS sender on your existing plan (~100–200/day carrier limit). Worth doing purely for the demo moment — a judge holding a ₹1,000 feature phone watching the ETA arrive is worth more than any slide. **Optional, not required.**

**The pitch line:** *"Pilot runs entirely on free channels. The no-data SMS tier is built as an interface and mocked — production plugs in the state's existing DLT gateway with one adapter class."*

### ⚠️ The demo trap: cold starts

Free hosting tiers sleep after idle. **A 50-second cold start in front of judges will kill your demo.**

```mermaid
flowchart TD
    A["Free tier idles<br/>15 min"] --> B["Container sleeps 😴"]
    B --> C["Judge taps 'Book slot'"]
    C --> D["⏳ 50 second cold start"]
    D --> E["❌ Demo dead"]

    F["✅ FIX: keep-alive ping<br/>every 10 min"] --> G["GitHub Actions cron<br/>or UptimeRobot free"]
    G --> H["Container never sleeps"]
    H --> I["✅ Instant response"]

    style E fill:#fde2e2,stroke:#c0392b
    style I fill:#e8f5e9,stroke:#2e7d32
```

Two belts, both free:
1. **Keep-alive cron** hitting `/health` every 10 minutes.
2. **Warm it manually 15 minutes before you present.** Do this even with the cron. Assume the cron failed.

**Better still: use Oracle Always Free.** It's a real always-on VM — it never sleeps, so this entire class of problem disappears.

### 🎓 Highest-leverage free move: GitHub Student Developer Pack

You're students competing in SIH. **Apply on day one** — approval can take days.

| Included *(verify current offers)* | Worth |
|---|---|
| DigitalOcean credit | Removes every hosting constraint above |
| Microsoft Azure credit | Alternative hosting + managed Postgres |
| Namecheap domain, 1 year free | A real domain for the pitch |
| GitHub Copilot | Faster build |
| Various DB / monitoring credits | Removes free-tier caps |

Even one hosting credit turns *"we squeezed into a free tier"* into *"we ran a proper deployment."*

### What you genuinely cannot get for free

Be upfront about these rather than pretending:

| Item | Cost | Verdict |
|---|---|---|
| **IVR / outbound voice calls** | No usable free tier | **Defer to Phase 3.** Already scheduled there. Demo the concept on a slide; don't fake it. |
| **Production SMS at state scale** | DLT + per-message cost | **Not your problem.** The state already owns this infrastructure. Say so. |
| **Play Store listing** | $25 one-time | **Skip.** APK via GitHub Releases + QR code is fine for judges. |
| **Aadhaar / eKYC integration** | Requires authorised entity | **Mock it.** Nobody expects a student team to have KYC access. |

The pattern: everything you can't afford is something the *government partner already has*. That's not a gap in your project — it's the handover story. Put it on a slide.

### Cost summary

| Phase | Monthly cost |
|---|---|
| **Phase 1 — SIH demo & pilot** | **₹0** |
| **Phase 2 — one district, real farmers** | **₹0** *(free channels hold; SMS only if the state supplies the gateway)* |
| **Phase 3 — state rollout** | Runs on the state's existing NIC/MeghRaj + DLT infrastructure — **not new spend** |

---

## 16. Scaling

### The defining characteristic: this workload is *violently* seasonal

```mermaid
gantt
    title Load profile across a procurement year
    dateFormat YYYY-MM-DD
    axisFormat %b
    section Rabi (wheat)
    Peak load — near 100%          :crit, 2026-03-15, 60d
    section Kharif (paddy)
    Peak load — near 100%          :crit, 2026-10-01, 60d
    section Off-season
    Near-zero load                 :done, 2026-05-15, 138d
    Near-zero load                 :done, 2026-12-01, 104d
```

**~120 active days a year.** Design consequences:

| Concern | Approach |
|---|---|
| **Cost off-season** | Aggressive autoscale to near-zero. Serverless for the notification workers. Government budgets are scrutinised — this is a *pitch asset*, not just engineering. |
| **Peak burst** | Load is read-heavy (farmers checking status). Cache ETAs in Redis with short TTL; a status check must never touch Postgres. |
| **Morning write spike** | Gate scans cluster 06:00–10:00. Queue writes through Redis, batch-persist to Postgres. |
| **Natural sharding** | Partition by **state → district**. A farmer never queries across states. Districts scale independently. |
| **Rollout** | 1 district pilot → state → multi-state. Per-state deploys respect the fact that procurement rules genuinely differ. |

### Scaling path

```mermaid
flowchart LR
    P1["Phase 1<br/>1 district<br/>~50 centres<br/><b>single instance</b>"] --> P2["Phase 2<br/>1 state<br/>~3,000 centres<br/><b>read replicas + Redis cluster</b>"]
    P2 --> P3["Phase 3<br/>multi-state<br/><b>district-sharded,<br/>per-state deploys</b>"]

    style P1 fill:#e8f5e9,stroke:#2e7d32
    style P2 fill:#fff3e0,stroke:#ef6c00
    style P3 fill:#e3f2fd,stroke:#1565c0
```

> ⚠️ **Centre and farmer counts above are planning assumptions.** Replace with real figures for your target state before pitching — a judge from DoCA will know the actual numbers.

---

## 17. Implementation roadmap

**The SIH trap is building seven features half-way.** Three working end-to-end beats seven on slides.

```mermaid
flowchart TB
    subgraph PH1["🎯 PHASE 1 — DEMO-CRITICAL"]
        direction TB
        F1["Capacity-aware Slot Engine"]
        F2["Virtual Queue + Live ETA"]
        F3["Offline app + delta sync"]
        F4["On-device advisor"]
        F5["Notification ladder<br/>push → WhatsApp → email"]
    end
    subgraph PH2["📈 PHASE 2 — COMPLETES THE PS"]
        direction TB
        F6["Payment pipeline tracker"]
        F7["Officer dashboard"]
        F8["Gate operator offline app"]
    end
    subgraph PH3["🚀 PHASE 3 — SCALE STORY"]
        direction TB
        F9["Cross-centre load balancing"]
        F10["IVR + FPO kiosk"]
        F11["State portal integration"]
    end
    PH1 --> PH2 --> PH3

    style PH1 fill:#e8f5e9,stroke:#2e7d32,stroke-width:3px
    style PH2 fill:#fff3e0,stroke:#ef6c00
    style PH3 fill:#eceff1,stroke:#607d8b
```

**Demo script — 6 minutes, one story:**

1. Officer logs bag shortage → capacity drops 62 → 47, **with the reason published**
2. Ramesh opens the app **in aeroplane mode** → still gets ranked slots → *"today 68% rejection risk, wait 2 days"*
3. Books Thursday. Centre slips 90 min → **push fires; kill the app and the WhatsApp/email fallback lands on a second device** *(add real SMS here if you get a spare phone + SIM)*
4. Ramesh replans **from home**
5. Geofence activates the token on approach → gate scans **offline**
6. Payment tracker starts; force an SLA breach → officer dashboard lights up

Steps 2 and 3 are the ones judges will remember. Rehearse those until they cannot fail.

---

## 18. How we prove it works

Ship instrumentation from day one. A number beats an adjective.

| Metric | Baseline (today) | Target | Why it matters |
|---|---|---|---|
| **Trips per successful sale** | ~2.3 | **< 1.2** | The headline. Each avoided trip ≈ ₹1,500–4,000 saved. |
| **Time in yard** | 1–3 days | **< 3 hours** | The literal problem statement. |
| **ETA accuracy** (within ±30 min) | n/a | **> 85%** | Trust metric. Below 70%, the virtual queue collapses. |
| **Notification reach** (any channel) | n/a | **> 95%** | Proves the offline ladder works. |
| **Payment SLA compliance** | unmeasured | **> 90%** | Currently invisible — measuring it is itself a win. |
| **Advisor adoption** | n/a | **> 60%** follow the recommendation | Measures whether farmers actually believe us. |

> **Baselines are illustrative.** Establish real ones from your pilot district — an honest measured baseline is worth more in the pitch than an impressive guess.

---

## 19. Risks we're not hiding from

| Risk | Reality | Mitigation |
|---|---|---|
| **ETA that lies** | One bad prediction and farmers revert to 5 AM forever | Conservative estimates; always show a range; visible freshness stamps; publish accuracy openly |
| **Arhtiya resistance** | Commission agents profit from opacity and are politically influential | Position them as *users* — give them a bulk-booking role rather than routing around them |
| **Centre staff won't log inputs** | The capacity engine is worthless without daily bag/labour data | Make it 30 seconds on a phone; auto-fill from yesterday; the officer dashboard makes non-logging *visible* |
| **Low smartphone penetration** | A large share of the user base has feature phones | SMS + IVR stay **first-class in the design** — built as ports, mocked in the pilot, filled by the state. Never claim the free-channel pilot reaches every farmer. |
| **State portal integration** | Every state's API differs, and some have none | Adapter pattern per state; degrade to CSV import; never block on integration |
| **Seasonal team amnesia** | 8 months between seasons; nobody remembers how it runs | Boring stack, thorough runbooks, no clever code |

---

## 20. Open decisions

Before writing code, settle these:

- [ ] **Which state?** Punjab / Haryana / MP / UP — flows differ meaningfully. Pick one and learn its existing portal *cold*. A specific credible demo beats a generic one.
- [ ] **Which crop?** Wheat (Rabi) and paddy (Kharif) have different moisture rules and rejection dynamics.
- [ ] **Real SLA values** from that state's actual procurement policy.
- [ ] **Real baselines** — current average wait, trips per sale, payment lag. Ask an FPO or a district office.
- [ ] **Does the target state's portal have an API?** Determines Phase 3 effort entirely.

**Do these on day one — they have lead times:**

- [ ] **Apply for the GitHub Student Developer Pack.** Approval takes days. Highest-leverage free move available to you. See §15.
- [ ] **Try to claim an Oracle Cloud Always Free ARM instance.** Capacity is often unavailable — start retrying early so you aren't stuck on a sleeping free tier.
- [ ] **Start WhatsApp Cloud API verification.** Meta Business setup + number verification takes days, and it's the one free channel that genuinely reaches farmers.
- [ ] **Set up a Telegram bot as the guaranteed fallback** — 20 minutes, zero approval, insurance against WhatsApp verification stalling.
- [ ] **Create a dedicated project email account** for Brevo/Resend/SMTP — never wire a personal account into the backend.
- [ ] **Make the repo public** — unlocks free GitHub Actions, and judges like seeing the work.

---

## 21. Summary

**VAARI is not a booking app.**

It is a **live operations system** built on one insight: *the queue is a trust problem wearing a scheduling problem's clothes.* Publish real capacity with real reasons → farmers believe the number → they obey a virtual queue and follow an offline advisor → the dawn stampede and the wasted trips both disappear → and a transparent payment pipeline closes the loop that made them distrustful in the first place.

Everything in this document serves that chain. Anything that doesn't, we cut.

---

<sub>SIH 2026 · PS 26032 · Built for the Department of Consumer Affairs</sub>
