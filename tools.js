// The service areas the concierge covers.
//
// `itinerary` is deliberately FIRST and is a different kind of tool: instead of
// owning its own bookings, it reads every other thread on the tour and composes
// the whole trip into one day-by-day plan. Everything below it is a specialist
// area that feeds it.
//
// `allergyRelevant` marks the areas where a food allergy can actually hurt
// someone — those get the strict safety verdict. The rest report
// "not_applicable" so the warning still means something when it appears.
//
// `loyaltyCategory` says which kind of rewards programme can earn on this area,
// so the concierge only ever mentions a programme the person actually holds in
// that category. `agencyBookable` says whether the travel agency can place the
// booking on the artist's behalf (for its per-booking fee).

export const TOOLS = [
  {
    id: "itinerary",
    label: "Tour Planner",
    icon: "🗺️",
    master: true,
    allergyRelevant: true,
    loyaltyCategory: null,
    agencyBookable: true,
    blurb:
      "The whole trip in one place — pulls together every other service area into a day-by-day plan with times, transfers, what's being carried, and booking links.",
    placeholder:
      "e.g. 14–17 May: Berlin (show on the 15th), then Munich 18–19. 5 people, 6 gear cases. Plan the whole thing — hotels, food, transfers, and shipping the cases between cities.",
    prefHint: "always land a day early, no two-city days, buffer before soundcheck",
  },
  {
    id: "hotel",
    label: "Hotels & Lodging",
    icon: "🏨",
    allergyRelevant: true,
    loyaltyCategory: "hotel",
    agencyBookable: true,
    blurb: "Where the artist sleeps — room type, noise, location, on-site food.",
    placeholder:
      "e.g. Two nights in Berlin around the Columbiahalle show. Quiet room, late checkout.",
    prefHint: "quiet room, high floor, late checkout, gym on site",
  },
  {
    id: "dining",
    label: "Restaurants & Dining",
    icon: "🍽️",
    allergyRelevant: true,
    loyaltyCategory: "dining",
    agencyBookable: true,
    blurb: "Pre/post-show meals, team dinners, and anything with a kitchen.",
    placeholder: "e.g. Post-show dinner for 6 near the venue, open past midnight.",
    prefHint: "quiet tables, late kitchen, no tasting menus",
  },
  {
    id: "catering",
    label: "Backstage & Catering",
    icon: "🥗",
    allergyRelevant: true,
    loyaltyCategory: "dining",
    agencyBookable: true,
    blurb: "Green room rider, backstage catering, and day-of food.",
    placeholder: "e.g. Green room catering for 8, one vegan and one celiac in the party.",
    prefHint: "hot food at soundcheck, no nuts backstage",
  },
  {
    id: "courier",
    label: "Courier & Freight",
    icon: "📦",
    allergyRelevant: false,
    loyaltyCategory: null,
    agencyBookable: true,
    blurb:
      "Moving gear, merch, and instruments between cities — carriers, pickup windows, customs paperwork.",
    placeholder:
      "e.g. Ship 4 flight cases from the Berlin venue to Munich on the 16th, needs to arrive before load-in on the 18th.",
    prefHint: "insured, tracked, door-to-door, no third-party handoffs",
  },
  {
    id: "transport",
    label: "Ground Transport",
    icon: "🚐",
    allergyRelevant: false,
    loyaltyCategory: "car",
    agencyBookable: true,
    blurb: "Cars, vans, drivers, and venue runs.",
    placeholder: "e.g. Airport pickup for 5 plus gear, then hotel to venue at 4pm.",
    prefHint: "sprinter van, no small talk, gear space",
  },
  {
    id: "flights",
    label: "Flights & Rail",
    icon: "✈️",
    allergyRelevant: false,
    loyaltyCategory: "air",
    agencyBookable: true,
    blurb: "Long-haul routing between tour legs.",
    placeholder: "e.g. Berlin to Paris on the 14th, land before 2pm for soundcheck.",
    prefHint: "aisle seat, no red-eyes, lounge access",
  },
  {
    id: "venue",
    label: "Venue Logistics",
    icon: "🎤",
    allergyRelevant: false,
    loyaltyCategory: null,
    agencyBookable: false,
    blurb: "Load-in, soundcheck timing, and venue-side contacts.",
    placeholder: "e.g. Load-in times and parking for the Columbiahalle show.",
    prefHint: "early soundcheck, secure gear storage",
  },
  {
    id: "wellness",
    label: "Wellness & Recovery",
    icon: "🧘",
    allergyRelevant: false,
    loyaltyCategory: null,
    agencyBookable: false,
    blurb: "Gyms, physio, vocal rest, and recovery between shows.",
    placeholder: "e.g. Find a physio near the hotel who can see me on a day off.",
    prefHint: "24h gym, steam room, vocal-friendly humidity",
  },
  {
    id: "medical",
    label: "Medical & Pharmacy",
    icon: "⚕️",
    allergyRelevant: true,
    loyaltyCategory: null,
    agencyBookable: false,
    blurb: "Pharmacies, urgent care, and allergy-safe medication sourcing.",
    placeholder: "e.g. Nearest 24h pharmacy that stocks epinephrine auto-injectors.",
    prefHint: "English-speaking clinic, 24h pharmacy",
  },
  {
    id: "grocery",
    label: "Groceries & Supplies",
    icon: "🛒",
    allergyRelevant: true,
    loyaltyCategory: null,
    agencyBookable: false,
    blurb: "Bus stock, apartment groceries, and specialty dietary supplies.",
    placeholder: "e.g. Stock the bus in Hamburg — oat milk, gluten-free bread.",
    prefHint: "oat milk, sparkling water, specific brands",
  },
  {
    id: "downtime",
    label: "Downtime & Activities",
    icon: "🎧",
    allergyRelevant: false,
    loyaltyCategory: "other",
    agencyBookable: true,
    blurb: "Days off, guests, and things worth doing between shows.",
    placeholder: "e.g. Quiet day-off suggestions in Munich, nothing touristy.",
    prefHint: "record shops, low-key, no crowds",
  },
];

export const TOOL_IDS = TOOLS.map((t) => t.id);
export const MASTER_TOOL_ID = "itinerary";

// Itinerary segment states.
//
// Nothing in this system can make a reservation, so there is no state that
// means "a booking exists" unless a human told us they made one. The model is
// never allowed to set these — the server derives them (see
// deriveSegmentStatus in server.js).
export const SEGMENT_STATUS = {
  PLANNED: "planned", // the concierge proposed it; nothing has happened
  SELECTED: "selected", // a specialist chat has this option marked chosen
  CONFIRMED: "confirmed", // the user booked it themselves and told us
};

// How a booking was actually placed. The agency charges a flat fee per booking
// it places; booking direct costs nothing extra. This is recorded per confirmed
// segment so the fee total reflects real bookings, not proposals.
export const BOOKING_CHANNELS = {
  DIRECT: "direct",
  AGENCY: "agency",
};

// Default agency terms — free to use, flat fee per booking placed. Overridable
// per person, because a different artist may be on different terms.
export const DEFAULT_AGENCY = {
  enabled: true,
  name: "Lifestyle travel agency",
  feePerBooking: 50,
  currency: "USD",
  contact: "",
  notes: "Free to use. Flat fee charged per booking the agency places.",
};

// Who travels with the artist. Everyone on this list who is actually travelling
// contributes their own constraints — the strictest allergy in the party wins.
export const PARTY_ROLES = [
  "artist",
  "tour manager",
  "travel manager",
  "family",
  "crew",
  "security",
  "guest",
];

// Rewards programme categories, matched against a tool's `loyaltyCategory` so
// the concierge only cites a programme that can actually earn on this booking.
export const LOYALTY_CATEGORIES = ["hotel", "air", "rail", "car", "dining", "other"];

export function getTool(id) {
  return TOOLS.find((t) => t.id === id) || null;
}

/** Every specialist area — i.e. everything the master planner draws from. */
export function specialistTools() {
  return TOOLS.filter((t) => !t.master);
}
