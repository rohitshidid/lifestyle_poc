# System Health — Operations Hub

> Maintained by the IHMS (Intelligent Health Monitoring System).
> Tracks the active state and trajectory of the project. Updated after every interaction.

_Last updated: 2026-07-23_

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

- _Tech stack not yet chosen — TBD during discovery._

## Active Rules
_Current development guidelines in effect._

- No code is to be written yet — currently in the brainstorming / product-discovery phase.
- Git: commits go to `main`, authored/committed as Rohit Shidid <rohitshidid@gmail.com>,
  with no AI attribution in messages, authors, or trailers. (See `selfcorrection.md`.)

## Current Tasks
_The macro-level task currently being worked on._

- Product discovery & scoping for the musician concierge platform (brainstorming, no code).

## Micro-tasks
_A granular checklist of the immediate next steps needed to complete the current task._

- [x] Capture the product vision and core domain concepts
- [ ] Confirm customer & payer (artist vs. tour manager / management / label)
- [ ] Confirm MVP ambition (white-glove concierge for few vs. scalable self-serve)
- [ ] Decide booking approach (direct vendor partnerships vs. aggregator APIs)
- [ ] Confirm geography scope (domestic vs. international)
- [ ] Confirm revenue model (subscription / commission / retainer)
- [ ] Pick the wedge vertical to prove the concept first
- [ ] Draft domain model + phased roadmap once the above are answered

## Upcoming Goals
_The roadmap of future features or refactoring._

- Define the domain model (Artist, Preference Profile, Tour, Booking, Vendor, Feedback).
- Design the internal ops/concierge dashboard (concierge-first approach).
- Plan preference-learning / feedback loop.
- Evaluate vendor-network vs. aggregator-API integration strategy.
