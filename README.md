# lifestyle_poc

Concierge platform for touring musicians (proof of concept).

## What this POC does

A single-page web app where an artist (or their tour manager) types a free-form
paragraph describing a trip — location, dietary constraints, allergies, and any
other preferences. Gemini (`gemini-2.5-flash`) extracts the constraints, searches
the web live via Google Search grounding, and returns a list of real hotel links
that match those needs, with a note on how each one fits the dietary/allergy
requirements.

## How it's organised

```
Person (profile)
  ├── global constraints  (dietary, allergies, standing preferences)
  ├── party               (everyone on the road, each with their OWN constraints)
  ├── suppliers           (preferred hotel chains / airlines / rail / car, plus a blacklist)
  ├── loyalty             (Hilton Honors, airline schemes, VIP programmes — tier + number)
  ├── agency              (travel-agency terms: free to use, flat fee per booking)
  ├── tools × 12          (per-service preferences — hotel prefs ≠ transport prefs)
  └── tours
        ├── one conversation thread per service area
        └── one master itinerary composed from all of them
```

Pick a **person** and a **tour** in the sidebar, pick a **service area** from the
tabs, and talk. Alongside the master **Tour Planner** the service areas are hotels,
dining, backstage catering, courier & freight, ground transport, flights, venue
logistics, wellness, medical, groceries, and downtime.

## Tour Planner (the first tab)

The Tour Planner doesn't book one thing — it plans the whole trip. Give it the
shape of the tour ("14–17 May Berlin, show on the 15th, then Munich 18–19, 5 people
and 6 gear cases") and it composes a **day-by-day itinerary**, pulling in whatever
the specialist chats have already locked in.

Each day is a timeline of segments with a **time**, what happens, where, the
provider, and **a direct booking link**.

### Nothing here is booked until you book it

The app cannot make reservations, so it never claims one exists. Each segment
carries one of three states, all derived from things a human actually did — the
model's own claims are discarded:

| State | Meaning |
|---|---|
| `suggested` | The concierge proposed it. Nothing has happened. |
| `your pick — not booked` | You chose this option in a specialist chat. Still not a reservation. |
| `booked by you` | You booked it yourself and pressed **Mark as booked** (optionally with a reference number). |

Confirmations are keyed to the day and the segment title, so if the planner later
shifts a confirmed pickup by 15 minutes it stays confirmed. Anything physically moving between cities — gear, merch, instruments — is
tracked separately with its carrier, collection window, and required arrival time,
so shipping that lands after load-in gets flagged. Anything still unresolved shows
up in a "still to sort" list.

Because it reads the other threads, a hotel you chose in the hotels chat shows up
as an already-booked segment rather than a fresh suggestion.

## Tour memory

Each `(tour, service area)` pair is its own continuous conversation. Every message
is sent with the tour's locked-in decisions, the options already considered (and
which were rejected and why), and the recent conversation.

So mid-tour changes work the way you'd expect: say *"route changed, we dropped
Berlin — we're in Munich now"* and the concierge knows which decisions that
supersedes, doesn't re-propose the hotel you already rejected, and carries
everything still valid forward instead of starting over. Superseded decisions are
called out in the UI.

Mark any option **Choose** or **Reject** and that status feeds the next message.
Every considered option in the sidebar is **clickable** — expand it to re-read the
summary written when it was suggested, along with its location, price tier,
allergy verdict, and link.

## Continuous learning

After each exchange the system extracts **durable** facts and files them in the
right place — profile-wide vs service-specific ("prefers boutique over chain
hotels", stored on hotels only). Trip-specific details stay out of the profile and
live as tour decisions instead.

**Personal facts are global, wherever you mention them.** Say "I've gone dairy-free"
while booking a van and it lands on the person, not on transport — so the dining and
catering chats pick it up too. Same for allergies and hard bodily constraints. A
banner confirms what was written to the person.

Learning is **additive only**: it can add or escalate a constraint, never delete one.

## The travelling party

An artist does not travel alone, so the profile does not stop at the artist.
Add the tour manager, travel manager, family, and crew, each with their own
dietary needs, allergies, and preferences.

- **Every constraint in the party binds every booking.** The party shares tables,
  vans, and green rooms, so the *strictest* constraint governs — if the tour
  manager is coeliac and the artist is not, the restaurant still has to handle
  coeliac.
- Allergy severity is merged across the whole party using the same
  escalate-only rule, and every warning **names whose allergy it is** — "tree
  nuts (severe; Dana)" is what a kitchen can act on.
- Mark someone **not travelling** to keep them as a contact without applying
  their constraints, and **books on behalf** to have booking requests addressed
  to them.
- The concierge can attach a learned constraint to a *named, existing* member,
  but it will never invent one — party membership is entered by a human.

## Suppliers and rewards

- **Preferred suppliers** — hotel chains, airlines, rail operators, car hire —
  are offered first when they genuinely fit. The **never propose** list is
  absolute.
- **Rewards & VIP programmes** are stored with tier, membership number, and
  a balance you type in. Each service area is tagged with the programme
  category that can earn on it, so a hotel programme is never cited on a van.
- The model may only name a programme you actually hold, in a category that
  can earn there. Anything else is stripped server-side before it reaches you.
- **No points arithmetic, ever.** The system has no live balance and cannot
  compute an accrual, so any invented figure is scrubbed and earning is
  described qualitatively. Your stored balance is displayed as what you typed
  and when.

## Booking channels and the agency fee

Every proposal can be booked two ways, and the difference costs money:

| Channel | Cost |
|---|---|
| **Direct** via the supplied link | free |
| **Through the travel agency** | free to engage, flat fee per booking placed (default $50) |

- The fee is a fact from the profile, attached server-side — the model never
  quotes a price.
- The concierge flags where the fee genuinely earns itself (multi-leg or group
  bookings, freight and customs, held reservations) and says so plainly when a
  booking is a two-click job you should just do yourself.
- **Marking a segment booked asks which channel you used**, and only then is a
  fee recorded. The itinerary shows what the agency has actually cost and what
  the outstanding recommendations would add.
- Tick segments and **Compose agency request** to get a ready-to-send brief:
  the bookings, the party, every allergy in it, and the loyalty numbers to
  apply. It is built from stored facts with no model call, because it is the
  document a human acts on.

## Learning from public sources

**Research this artist** searches public sources — interviews, published riders,
press, official channels — for stated travel and hospitality preferences.

Nothing it finds is a fact:

- Every suggestion carries a **real source URL and a short quote**. Anything
  without a source is dropped before you ever see it.
- Each is graded **well sourced / second-hand / inferred**, and nothing is
  written to the profile until you press **Accept**. Accepted entries are
  tagged with their source so a press-derived preference is never confused
  with something the artist told you.
- **Health claims are never filed as constraints.** An allergy reported by the
  press comes back as a note to check with the artist, never as a stored
  allergy — the press is wrong often enough and the cost of being wrong here is
  somebody in hospital.
- Private life, finances, and tabloid material are out of scope.

## Allergy safety

Allergies are treated as a stricter class than preferences:

- They are stored with a **severity** (`severe` / `moderate` / `mild`), and a merge
  can only ever *escalate* it — a downgrade is refused.
- Stored allergies stay in force even if a message forgets to mention them.
- On allergy-relevant service areas (hotels, dining, catering, groceries, medical)
  every option gets an explicit verdict — `verified` (evidence found), `unverified`
  (no allergen info), or `risk` (active conflict). **The model's verdict is not
  trusted**: a missing, malformed, or evidence-free "safe" claim is rewritten to
  `unverified` server-side before it reaches the user.
- Non-food areas like transport return `not_applicable`, so the warning means
  something when it does appear.
- Results carry a banner naming the active allergies and how many are unverified.

## Architecture

- **Frontend** — `public/index.html` + `styles.css` + `app.js` (vanilla): tool tabs,
  conversation thread, options, and the sidebar for person / party / suppliers &
  rewards / agency / research / tour / preferences / tour memory. List fields use
  chip editors rather than comma-separated inputs.
- **Backend** — `server.js` (Node + Express): profile, party, loyalty, agency,
  enrichment, tool-preference, tour, and thread routes plus `POST /api/chat`,
  which assembles the memory context, calls Gemini, enforces allergy safety and
  loyalty claims, attaches booking channels, persists the turn, and merges
  learnings.
- **Store** — `store.js`: JSON-file persistence at `data/profiles.json` (gitignored),
  with serialized writes, the escalation-only allergy merge, party-wide allergy
  union, and per-booking fee accounting.
- **Catalog** — `tools.js`: the 12 service areas, their allergy relevance, which
  loyalty category can earn on each, and whether the agency can book it.
- **LLM** — `gemini-2.5-flash` (Google `@google/genai` SDK) with `googleSearch`
  grounding for real links.

## Running it

```bash
npm install
cp .env.example .env      # then paste your GEMINI_API_KEY into .env
npm start                 # serves http://localhost:3000
```

Requires a `GEMINI_API_KEY` (Google AI Studio).

## IHMS state files

This repo is maintained under the Intelligent Health Monitoring System workflow.
See `system_health.md`, `selfcorrection.md`, and `wiki.md` for the current state,
preference ledger, and codebase map.
