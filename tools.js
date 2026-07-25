// The service categories the concierge covers. Each profile keeps its own
// preferences per tool, and each tour keeps a separate conversation thread per
// tool, so "where he sleeps" and "how he gets around" never bleed into each
// other.
//
// `allergyRelevant` marks the tools where a food allergy can actually hurt
// someone — those get the strict safety verdict treatment. The rest get
// "not_applicable" so the UI isn't crying wolf on a car service.

export const TOOLS = [
  {
    id: "hotel",
    label: "Hotels & Lodging",
    icon: "🏨",
    allergyRelevant: true,
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
    blurb: "Pre/post-show meals, team dinners, and anything with a kitchen.",
    placeholder: "e.g. Post-show dinner for 6 near the venue, open past midnight.",
    prefHint: "quiet tables, late kitchen, no tasting menus",
  },
  {
    id: "catering",
    label: "Backstage & Catering",
    icon: "🥗",
    allergyRelevant: true,
    blurb: "Green room rider, backstage catering, and day-of food.",
    placeholder: "e.g. Green room catering for 8, one vegan and one celiac in the party.",
    prefHint: "hot food at soundcheck, no nuts backstage",
  },
  {
    id: "grocery",
    label: "Groceries & Supplies",
    icon: "🛒",
    allergyRelevant: true,
    blurb: "Bus stock, apartment groceries, and specialty dietary supplies.",
    placeholder: "e.g. Stock the bus in Hamburg — oat milk, gluten-free bread.",
    prefHint: "oat milk, sparkling water, specific brands",
  },
  {
    id: "transport",
    label: "Ground Transport",
    icon: "🚐",
    allergyRelevant: false,
    blurb: "Cars, vans, drivers, and venue runs.",
    placeholder: "e.g. Airport pickup for 5 plus gear, then hotel to venue at 4pm.",
    prefHint: "sprinter van, no small talk, gear space",
  },
  {
    id: "flights",
    label: "Flights & Rail",
    icon: "✈️",
    allergyRelevant: false,
    blurb: "Long-haul routing between tour legs.",
    placeholder: "e.g. Berlin to Paris on the 14th, land before 2pm for soundcheck.",
    prefHint: "aisle seat, no red-eyes, lounge access",
  },
  {
    id: "venue",
    label: "Venue Logistics",
    icon: "🎤",
    allergyRelevant: false,
    blurb: "Load-in, soundcheck timing, and venue-side contacts.",
    placeholder: "e.g. Load-in times and parking for the Columbiahalle show.",
    prefHint: "early soundcheck, secure gear storage",
  },
  {
    id: "wellness",
    label: "Wellness & Recovery",
    icon: "🧘",
    allergyRelevant: false,
    blurb: "Gyms, physio, vocal rest, and recovery between shows.",
    placeholder: "e.g. Find a physio near the hotel who can see me on a day off.",
    prefHint: "24h gym, steam room, vocal-friendly humidity",
  },
  {
    id: "medical",
    label: "Medical & Pharmacy",
    icon: "⚕️",
    allergyRelevant: true,
    blurb: "Pharmacies, urgent care, and allergy-safe medication sourcing.",
    placeholder: "e.g. Nearest 24h pharmacy that stocks epinephrine auto-injectors.",
    prefHint: "English-speaking clinic, 24h pharmacy",
  },
  {
    id: "downtime",
    label: "Downtime & Activities",
    icon: "🎧",
    allergyRelevant: false,
    blurb: "Days off, guests, and things worth doing between shows.",
    placeholder: "e.g. Quiet day-off suggestions in Munich, nothing touristy.",
    prefHint: "record shops, low-key, no crowds",
  },
];

export const TOOL_IDS = TOOLS.map((t) => t.id);

export function getTool(id) {
  return TOOLS.find((t) => t.id === id) || null;
}
