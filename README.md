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
  conversation thread, options, and the sidebar for person / tour / preferences /
  tour memory. List fields use chip editors rather than comma-separated inputs.
- **Backend** — `server.js` (Node + Express): profile, tool-preference, tour, and
  thread routes plus `POST /api/chat`, which assembles the memory context, calls
  Gemini, enforces allergy safety, persists the turn, and merges learnings.
- **Store** — `store.js`: JSON-file persistence at `data/profiles.json` (gitignored),
  with serialized writes and the escalation-only allergy merge.
- **Catalog** — `tools.js`: the 10 service areas and their allergy relevance.
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
