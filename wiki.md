# Project Wiki — The Encyclopedia

> Maintained by the IHMS (Intelligent Health Monitoring System).
> The definitive map of the codebase: architectural overviews, a file index, and
> line-number anchors linking documentation to the exact code it describes.

_Last updated: 2026-07-23_

## Architectural Overview
_High-level description of the project structure and how the pieces fit together._

`lifestyle_poc` is a proof-of-concept for a **concierge / lifestyle-management
platform for touring musicians**. Artists onboard once; the platform stores their
preferences and manages bookings/logistics (housing, hotels, restaurants, food
preferences, transport, etc.) on their behalf.

The intended domain revolves around a few core concepts (design not yet built):
- **Artist** and their **Preference Profile** (the persistent, learning source of truth).
- **Tour / Itinerary** — the central timeline; bookings attach to a city + date.
- **Booking** — a lodging/dining/transport reservation driven by the profile.
- **Vendor / Partner** — hotels, restaurants, drivers, with reliability ratings.
- **Feedback** — post-experience signal that refines the Preference Profile.

Currently no application code exists — the repository contains only project
documentation and IHMS state files. The project is in the brainstorming/discovery phase.

## File Index
_A detailed registry of what each file does and its exact location._

| File | Location | Purpose |
| ---- | -------- | ------- |
| `README.md` | `/README.md` | Project title / entry point. |
| `system_health.md` | `/system_health.md` | IHMS operations hub — active state and trajectory. |
| `selfcorrection.md` | `/selfcorrection.md` | IHMS preference ledger — user feedback memory. |
| `wiki.md` | `/wiki.md` | IHMS project encyclopedia — this file. |

## Line References
_Specific anchors / line-number references linking documentation to exact lines of code._

- _None yet — no application code exists to anchor against._
