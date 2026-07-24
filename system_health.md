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

## Active Rules
_Current development guidelines in effect._

- Git: commits go to `main`, authored/committed as Rohit Shidid <rohitshidid@gmail.com>,
  with no AI attribution in messages, authors, or trailers. (See `selfcorrection.md`.)

## Current Tasks
_The macro-level task currently being worked on._

- Build and iterate on the natural-language hotel finder (paragraph in → parsed
  constraints + matching hotel links out).

## Micro-tasks
_A granular checklist of the immediate next steps needed to complete the current task._

- [x] Choose stack (Node/Express + vanilla frontend + Gemini Google Search)
- [x] Backend `POST /api/search` endpoint calling Gemini with the googleSearch tool
- [x] Frontend: request textbox + parsed-constraints section + hotel-results section
- [x] README run instructions, `.env.example`, `.gitignore`
- [x] Switch LLM provider from Anthropic Claude to Google Gemini (per user request)
- [x] End-to-end test with a real `GEMINI_API_KEY` — confirmed working by user 2026-07-24
- [x] Draft AI/ML robustness roadmap (see Upcoming Goals)
- [ ] Decide which roadmap item to build next (recommended: Preference Profile)
- [ ] Handle edge cases (no location given, no results, search rate limits)

## Upcoming Goals
_The roadmap of future features or refactoring._

AI/ML robustness roadmap, drafted 2026-07-24. Ordered by value; Tier 1 is
load-bearing, Tier 3 assumes the earlier tiers are in place.

### Tier 1 — Robustness foundations
1. **Preference Profile with continuous learning** — persist per-artist durable
   facts (dietary, allergies, room prefs, vendor likes/dislikes) that the LLM
   writes to after each interaction; separate durable facts from per-trip details.
   The product's moat; everything else compounds on it.
2. **Hallucination guard / link verification** — verify each returned URL resolves
   and the hotel name appears on the page; drop or flag failures; attach a
   confidence score per result. Biggest current reliability risk.
3. **Structured, validated constraint extraction** — split extraction from search
   into its own schema-validated call with per-field confidence; enables
   clarifying questions and an eval set (paragraph → expected constraints).
4. **Safety-critical allergy reasoning** — treat allergies as a stricter class than
   preferences: never soft-match, never trade away, surface uncertainty explicitly
   when a venue publishes no allergen policy.

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
