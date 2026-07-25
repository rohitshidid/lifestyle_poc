# System Health — Operations Hub

> Maintained by the IHMS (Intelligent Health Monitoring System).
> Tracks the active state and trajectory of the project. Updated after every interaction.

_Last updated: 2026-07-24_

## Product Vision
A concierge / lifestyle-management platform for touring musicians. Artists (and/or
their tour managers) onboard once; the system captures their preferences and takes
over bookings and logistics — housing/hotels, restaurants, food preferences,
transport, and everything around a tour — so the artist never has to manage their
own preferences again.

**Core concepts driving the design:**
- **Preference Profile** — a rich, persistent, per-artist profile (dietary/allergies,
  cuisine likes/dislikes, room preferences, brand loyalties, accessibility, budget
  tiers, always/never rules). The product's moat; improves over time via feedback.
- **Tour / Itinerary** — the central timeline object. Bookings attach to a city on a
  date on a tour.
- **Preference-driven booking engine** — proposes options pre-filtered by profile.
- **Post-experience feedback loop** — feeds learned preferences back in.
- **Vendor / partner network** — first-class entity (hotels, restaurants, drivers)
  with reliability ratings.

## Non-Negotiables
_Core architectural rules, tech stack constraints, and absolute boundaries._

- Tech stack (POC): Node.js + Express backend, vanilla HTML/CSS/JS frontend.
- LLM provider: Google Gemini, model `gemini-2.5-flash`, via the official
  `@google/genai` SDK. Hotel links come from the `googleSearch` grounding tool —
  never fabricate links.
- Secrets (`GEMINI_API_KEY`) live only in `.env` (gitignored), never committed.
- **Allergy safety is a hard boundary, not a prompt suggestion.** Allergy severity
  may only ever escalate on merge (`store.js`), and no hotel may reach the user
  without an explicit verdict — any missing, malformed, or evidence-free "safe"
  claim is forced to `unverified` server-side (`server.js` → `enforceAllergySafety`).
- Continuous learning is **additive only** — it never deletes a stored constraint,
  because one ambiguous sentence must not be able to erase a standing allergy.

## Active Rules
_Current development guidelines in effect._

- Git: commits go to `main`, authored/committed as Rohit Shidid <rohitshidid@gmail.com>,
  with no AI attribution in messages, authors, or trailers. (See `selfcorrection.md`.)

## Current Tasks
_The macro-level task currently being worked on._

- Per-person × per-tool × per-tour architecture with conversational memory,
  plus a rebuilt UI. Implemented 2026-07-25.

## Data Hierarchy
The core model everything hangs off:

```
Person (profile)
  ├── global constraints  (dietary, allergies, standing preferences, learned notes)
  ├── tools{} × 10        (per-service preferences + learned notes)
  └── tours[]
        └── threads{} keyed by tool
              ├── messages[]    (the conversation for this tour + this service)
              ├── decisions[]   (what is locked in for this tour)
              └── considered[]  (options seen, with chosen/rejected status)
```

Each `(tour, tool)` pair is an independent thread. A route change mid-conversation
re-enters the same thread with prior decisions, rejected options, and the running
conversation already in context, so the concierge carries forward what is still
valid instead of restarting.

## Micro-tasks
_A granular checklist of the immediate next steps needed to complete the current task._

- [x] Choose stack (Node/Express + vanilla frontend + Gemini Google Search)
- [x] Backend `POST /api/search` endpoint calling Gemini with the googleSearch tool
- [x] Frontend: request textbox + parsed-constraints section + hotel-results section
- [x] README run instructions, `.env.example`, `.gitignore`
- [x] Switch LLM provider from Anthropic Claude to Google Gemini (per user request)
- [x] End-to-end test with a real `GEMINI_API_KEY` — confirmed working by user 2026-07-24
- [x] Draft AI/ML robustness roadmap (see Upcoming Goals)
- [x] **Roadmap #1 — Preference Profiles with continuous learning**
  - [x] `store.js` JSON-backed profile store with serialized writes
  - [x] Profile CRUD endpoints (`/api/profiles`)
  - [x] Right-side sidebar: create / select / edit / delete profiles
  - [x] Search merges the active profile's constraints into the prompt
  - [x] Post-search learning merge writes durable facts back to the profile
  - [x] Trip history logged per profile
- [x] **Roadmap #4 — Safety-critical allergy reasoning**
  - [x] Allergies stored with severity; escalation-only merge (verified by test)
  - [x] Server-side `enforceAllergySafety` guard (verified against 5 failure modes)
  - [x] Per-hotel verdict UI + severe-allergy warning banner
- [x] **Per-tool detail + per-tour memory** (2026-07-25)
  - [x] `tools.js` — 10 service areas, each flagged `allergyRelevant`
  - [x] Per-tool preferences and learned notes on each profile (isolated — verified)
  - [x] Tours per person; one conversation thread per (tour, tool) — isolation verified
  - [x] Threads persist messages, locked-in decisions, and considered options
        with chosen/rejected status
  - [x] Prompt carries prior decisions + rejected options + conversation so a
        route change supersedes rather than restarts (`supersededDecisions`)
  - [x] Allergy guard now scoped by `allergyRelevant` (verified across hotel /
        transport / medical)
- [x] **UI rebuild** (2026-07-25) — chip editors replace the overflowing
      comma-separated inputs; tool tabs, sticky sidebar, collapsible sections,
      split `styles.css` / `app.js`
- [ ] Handle remaining edge cases (no location given, no results, search rate limits)
- [ ] Next recommended: roadmap #2 (link verification) and #3 (structured extraction)

## Upcoming Goals
_The roadmap of future features or refactoring._

AI/ML robustness roadmap, drafted 2026-07-24. Ordered by value; Tier 1 is
load-bearing, Tier 3 assumes the earlier tiers are in place.

### Tier 1 — Robustness foundations
1. ~~**Preference Profile with continuous learning**~~ — ✅ **DONE 2026-07-25.**
   `store.js` + `/api/profiles` + right-side sidebar; search merges the active
   profile and folds durable facts back in after each run.
2. **Hallucination guard / link verification** — verify each returned URL resolves
   and the hotel name appears on the page; drop or flag failures; attach a
   confidence score per result. Biggest current reliability risk.
3. **Structured, validated constraint extraction** — split extraction from search
   into its own schema-validated call with per-field confidence; enables
   clarifying questions and an eval set (paragraph → expected constraints).
4. ~~**Safety-critical allergy reasoning**~~ — ✅ **DONE 2026-07-25.** Severity-ranked
   allergies, escalation-only merge, and a server-side verdict guard that downgrades
   any evidence-free "safe" claim to `unverified`.

### Tier 2 — Intelligence
5. **Learned ranking model** — rank results on constraint-match + price-fit +
   vendor rating; start hand-tuned, graduate to a learned model once booking
   volume exists.
6. **Post-stay feedback loop** — 2–3 questions after each stay feeding both the
   Preference Profile and vendor reliability scores.
7. **RAG over a proprietary vendor knowledge base** — accumulate first-party
   knowledge (who actually honored a dietary request, real venue distances) and
   retrieve it alongside web results. Primary long-term defensibility.
8. **Proactive anomaly & risk monitoring** — scheduled agent over the itinerary
   flagging risks before they bite (late check-in after a moved flight, restaurant
   closed on arrival night, venue-to-hotel distance blowout).

### Tier 3 — Scale-up
9. **Conversational multi-turn refinement with memory** — "cheaper", "closer to the
   venue" refines the prior result set instead of restarting.
10. **Multi-agent orchestration for full-trip planning** — specialist lodging /
    dining / transport agents under a planner that owns the itinerary and resolves
    inter-agent conflicts.

### Sequencing note
Start with 1 and 2; 3 makes both testable. Do not build the learned ranker (5)
before booking data exists — a hand-tuned scoring formula will outperform an
undertrained model on the first few hundred bookings.
