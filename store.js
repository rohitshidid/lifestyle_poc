// Preference store.
//
// Shape:
//   Profile (a person)
//     ├── global constraints (dietary, allergies, preferences, learned notes)
//     ├── party[]   — everyone who travels with them, each with their OWN
//     │               dietary/allergy/preference constraints
//     ├── brands{}  — preferred and blacklisted suppliers (hotel chains, airlines…)
//     ├── loyalty[] — rewards / VIP programmes held, with tier and balance
//     ├── agency{}  — travel-agency terms (free to use, flat fee per booking)
//     ├── enrichment{} — public-domain research SUGGESTIONS, never auto-applied
//     ├── tools{}  — per-tool preferences, so hotel prefs never leak into transport
//     └── tours[]  — a tour has one thread PER TOOL, and each thread remembers
//                    its own conversation, decisions, and everything considered
//
// Deliberately a flat JSON file: a POC needs zero-setup persistence, and the
// surface here is small enough to swap for a real database without touching
// callers.

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  TOOL_IDS,
  specialistTools,
  getTool,
  BOOKING_CHANNELS,
  DEFAULT_AGENCY,
  LOYALTY_CATEGORIES,
} from "./tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "profiles.json");

// All writes go through this chain so concurrent requests can't interleave a
// read-modify-write and lose an update.
let writeQueue = Promise.resolve();

async function readAll() {
  try {
    const parsed = JSON.parse(await fs.readFile(DB_PATH, "utf8"));
    return parsed.map(normalizeProfile);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(profiles) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(profiles, null, 2));
}

function serialize(fn) {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {}); // keep the chain alive after a failure
  return next;
}

// ---------------------------------------------------------------------------
// Normalization — lets profiles written by an older version load cleanly.
// ---------------------------------------------------------------------------

function blankThread() {
  return {
    messages: [], // {role: "user"|"agent", text, at}
    decisions: [], // {at, text} — standing choices for this tour+tool
    // Options already seen. Each carries the full summary the concierge wrote
    // for it, so the sidebar can show why it was suggested without re-asking
    // the model.
    considered: [], // {at, name, url, status, reason, location, priceTier, notes, matches[], allergySafety}
  };
}

function blankTour(name) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: name || "Untitled tour",
    createdAt: now,
    updatedAt: now,
    threads: {}, // toolId -> thread, created lazily
    itinerary: null, // last plan composed by the master Tour Planner
    // Segments the USER has confirmed they actually booked, keyed by
    // segmentKey(). The model can never write here — a booking only exists
    // because a human said so.
    confirmations: {},
  };
}

/**
 * Stable identity for an itinerary segment across re-plans.
 *
 * Deliberately derived from day + title rather than including the time: if the
 * planner shifts a confirmed pickup by 15 minutes, that is the same real-world
 * booking and the confirmation should survive.
 */
export function segmentKey(day, segment) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(day)}::${norm(segment.title)}`;
}

// ---------------------------------------------------------------------------
// Party, brands, loyalty, agency
//
// These are the inputs the concierge was missing: who else is travelling and
// what THEY need, which suppliers the artist actually uses, which rewards
// programmes a booking should earn on, and how the travel agency is engaged.
// ---------------------------------------------------------------------------

const BRAND_FIELDS = ["hotelChains", "airlines", "railOperators", "carHire", "avoid"];

function normalizeBrands(b = {}) {
  const out = {};
  for (const f of BRAND_FIELDS) out[f] = mergeStrings([], b?.[f]);
  return out;
}

/**
 * A travelling companion. Their constraints are first-class: a tour manager
 * with a shellfish allergy is exactly as safety-critical as the artist's, and
 * the whole party eats at the same table.
 */
function normalizePartyMember(m) {
  if (!m) return null;
  const name = String(m.name || "").trim();
  if (!name) return null;
  return {
    id: m.id || crypto.randomUUID(),
    name,
    role: String(m.role || "crew").trim(),
    travels: m.travels !== false, // on the road by default; false = office-based
    email: String(m.email || "").trim(),
    phone: String(m.phone || "").trim(),
    // Someone who arranges bookings on the artist's behalf — travel manager,
    // tour manager, assistant. Surfaced so briefs get addressed to them.
    booksOnBehalf: !!m.booksOnBehalf,
    dietary: mergeStrings([], m.dietary),
    allergies: mergeAllergies([], m.allergies),
    preferences: mergeStrings([], m.preferences),
    notes: mergeStrings([], m.notes),
  };
}

function normalizeLoyalty(l) {
  if (!l) return null;
  const program = String(l.program || "").trim();
  if (!program) return null;
  const category = LOYALTY_CATEGORIES.includes(String(l.category || "").toLowerCase())
    ? String(l.category).toLowerCase()
    : "other";
  const points = Number(l.points);
  return {
    id: l.id || crypto.randomUUID(),
    program, // "Hilton Honors", "Star Alliance Gold", a venue VIP scheme…
    category,
    memberId: String(l.memberId || "").trim(),
    tier: String(l.tier || "").trim(),
    points: Number.isFinite(points) && points >= 0 ? points : null,
    // Only ever moved by a human — see recordPointsActivity.
    pointsUpdatedAt: l.pointsUpdatedAt || null,
    perks: mergeStrings([], l.perks),
    notes: String(l.notes || "").trim(),
  };
}

function normalizeAgency(a = {}) {
  const fee = Number(a?.feePerBooking);
  return {
    ...DEFAULT_AGENCY,
    ...a,
    enabled: a?.enabled !== false,
    feePerBooking: Number.isFinite(fee) && fee >= 0 ? fee : DEFAULT_AGENCY.feePerBooking,
    currency: String(a?.currency || DEFAULT_AGENCY.currency).trim() || DEFAULT_AGENCY.currency,
    name: String(a?.name || DEFAULT_AGENCY.name).trim() || DEFAULT_AGENCY.name,
    contact: String(a?.contact || "").trim(),
  };
}

/**
 * Public-domain research output. Suggestions live here in "pending" state and
 * are NEVER merged into the profile until a human accepts one — a press
 * interview is not the artist telling us something.
 */
function normalizeEnrichment(e = {}) {
  return {
    lastRunAt: e?.lastRunAt || null,
    lastSummary: String(e?.lastSummary || ""),
    suggestions: (e?.suggestions || [])
      .map((s) => {
        const value = typeof s?.value === "string" ? s.value.trim() : s?.value;
        if (!s?.field || !value) return null;
        return {
          id: s.id || crypto.randomUUID(),
          scope: s.scope === "tool" ? "tool" : "global", // global profile vs one service area
          toolId: TOOL_IDS.includes(s.toolId) ? s.toolId : null,
          field: String(s.field), // dietary | otherPreferences | notes | brands.hotelChains | preferences…
          value,
          confidence: ["high", "medium", "low"].includes(s.confidence) ? s.confidence : "low",
          source: String(s.source || "").trim(),
          sourceUrl: String(s.sourceUrl || "").trim(),
          quote: String(s.quote || "").trim(),
          status: ["pending", "accepted", "dismissed"].includes(s.status) ? s.status : "pending",
          at: s.at || new Date().toISOString(),
        };
      })
      .filter(Boolean),
  };
}

function normalizeProfile(p) {
  const tools = {};
  for (const id of TOOL_IDS) {
    const t = p.tools?.[id] || {};
    tools[id] = {
      preferences: Array.isArray(t.preferences) ? t.preferences : [],
      notes: Array.isArray(t.notes) ? t.notes : [],
    };
  }
  return {
    id: p.id,
    name: p.name || "Untitled profile",
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
    dietary: p.dietary || [],
    allergies: (p.allergies || []).map(normalizeAllergy).filter(Boolean),
    otherPreferences: p.otherPreferences || [],
    notes: p.notes || [],
    party: (p.party || []).map(normalizePartyMember).filter(Boolean),
    brands: normalizeBrands(p.brands),
    loyalty: (p.loyalty || []).map(normalizeLoyalty).filter(Boolean),
    agency: normalizeAgency(p.agency),
    enrichment: normalizeEnrichment(p.enrichment),
    tools,
    tours: (p.tours || []).map((t) => ({
      ...blankTour(t.name),
      ...t,
      threads: t.threads || {},
      itinerary: t.itinerary || null,
      confirmations: t.confirmations || {},
    })),
  };
}

// ---------------------------------------------------------------------------
// Allergy severity
//
// Severity is ranked so a merge can only ever escalate. Downgrading an allergy
// on the strength of a loosely-worded sentence is the one failure mode in this
// system that can put someone in hospital, so it is not permitted.
// ---------------------------------------------------------------------------

const SEVERITY_RANK = { unknown: 0, mild: 1, moderate: 2, severe: 3 };

export function normalizeSeverity(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("anaphyla") || v.includes("severe") || v.includes("critical")) return "severe";
  if (v.includes("moderate")) return "moderate";
  if (v.includes("mild")) return "mild";
  return "unknown";
}

function normalizeAllergy(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return { name: entry.trim(), severity: "unknown" };
  const name = String(entry.name || "").trim();
  if (!name) return null;
  return { name, severity: normalizeSeverity(entry.severity) };
}

/** Merge allergy lists, keeping the highest severity ever recorded for a name. */
export function mergeAllergies(existing = [], incoming = []) {
  const byName = new Map();
  for (const raw of [...existing, ...incoming]) {
    const a = normalizeAllergy(raw);
    if (!a) continue;
    const key = a.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, a);
      continue;
    }
    // Escalate only — never downgrade a recorded severity.
    if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[prev.severity]) {
      byName.set(key, { ...prev, severity: a.severity });
    }
  }
  return [...byName.values()];
}

/** Case-insensitive union of two string lists, preserving first-seen casing. */
export function mergeStrings(existing = [], incoming = []) {
  const seen = new Map();
  for (const raw of [...existing, ...incoming]) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

function blankProfile(name) {
  const now = new Date().toISOString();
  const tools = {};
  for (const id of TOOL_IDS) tools[id] = { preferences: [], notes: [] };
  return {
    id: crypto.randomUUID(),
    name: name || "Untitled profile",
    createdAt: now,
    updatedAt: now,
    dietary: [],
    allergies: [],
    otherPreferences: [],
    notes: [],
    party: [],
    brands: normalizeBrands(),
    loyalty: [],
    agency: normalizeAgency(),
    enrichment: normalizeEnrichment(),
    tools,
    tours: [],
  };
}

/**
 * Everyone whose constraints apply to a booking for this artist: the artist
 * themselves plus every party member who is actually on the road.
 *
 * Used for the allergy boundary — the table is shared, so the strictest
 * allergy in the travelling party governs every food option, not just the
 * artist's own.
 */
export function travellingParty(profile) {
  const members = (profile?.party || []).filter((m) => m.travels);
  return [
    {
      id: profile?.id,
      name: profile?.name || "Artist",
      role: "artist",
      dietary: profile?.dietary || [],
      allergies: profile?.allergies || [],
      preferences: profile?.otherPreferences || [],
      isArtist: true,
    },
    ...members.map((m) => ({ ...m, isArtist: false })),
  ];
}

/** Union of every allergy in the travelling party, escalated to the worst severity seen. */
export function partyAllergies(profile) {
  return travellingParty(profile).reduce(
    (acc, m) => mergeAllergies(acc, m.allergies || []),
    [],
  );
}

/** Which people in the party carry a given allergy — so a warning can name them. */
export function allergyOwners(profile, allergyName) {
  const key = String(allergyName || "").toLowerCase();
  return travellingParty(profile)
    .filter((m) => (m.allergies || []).some((a) => a.name.toLowerCase() === key))
    .map((m) => m.name);
}

export async function listProfiles() {
  const profiles = await readAll();
  return profiles.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export async function getProfile(id) {
  const profiles = await readAll();
  return profiles.find((p) => p.id === id) || null;
}

export async function createProfile(data = {}) {
  return serialize(async () => {
    const profiles = await readAll();
    const profile = {
      ...blankProfile(data.name),
      dietary: mergeStrings([], data.dietary),
      allergies: mergeAllergies([], data.allergies),
      otherPreferences: mergeStrings([], data.otherPreferences),
    };
    profiles.push(profile);
    await writeAll(profiles);
    return profile;
  });
}

/** Replace global fields outright — used by the manual profile editor. */
export async function updateProfile(id, patch = {}) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === id);
    if (i === -1) return null;
    const cur = profiles[i];
    profiles[i] = {
      ...cur,
      name: patch.name !== undefined ? String(patch.name).trim() || cur.name : cur.name,
      dietary: patch.dietary !== undefined ? mergeStrings([], patch.dietary) : cur.dietary,
      allergies:
        patch.allergies !== undefined ? mergeAllergies([], patch.allergies) : cur.allergies,
      otherPreferences:
        patch.otherPreferences !== undefined
          ? mergeStrings([], patch.otherPreferences)
          : cur.otherPreferences,
      notes: patch.notes !== undefined ? mergeStrings([], patch.notes) : cur.notes,
      brands: patch.brands !== undefined ? normalizeBrands(patch.brands) : cur.brands,
      updatedAt: new Date().toISOString(),
    };
    await writeAll(profiles);
    return profiles[i];
  });
}

// ---------------------------------------------------------------------------
// Party members
// ---------------------------------------------------------------------------

/** Add a member, or replace one by id. Their constraints are stored on them. */
export async function upsertPartyMember(profileId, member = {}) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1) return null;
    const next = normalizePartyMember(member);
    if (!next) return null;

    const party = profiles[i].party || [];
    const at = party.findIndex((m) => m.id === next.id);
    if (at === -1) party.push(next);
    else party[at] = next;

    profiles[i].party = party;
    profiles[i].updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return profiles[i];
  });
}

export async function deletePartyMember(profileId, memberId) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1) return null;
    profiles[i].party = (profiles[i].party || []).filter((m) => m.id !== memberId);
    profiles[i].updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return profiles[i];
  });
}

// ---------------------------------------------------------------------------
// Loyalty programmes
// ---------------------------------------------------------------------------

export async function upsertLoyalty(profileId, entry = {}) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1) return null;
    const next = normalizeLoyalty(entry);
    if (!next) return null;

    const loyalty = profiles[i].loyalty || [];
    const at = loyalty.findIndex((l) => l.id === next.id);
    if (at === -1) {
      if (next.points !== null) next.pointsUpdatedAt = new Date().toISOString();
      loyalty.push(next);
    } else {
      // Only stamp the balance date when the balance actually moved.
      const prev = loyalty[at];
      next.pointsUpdatedAt =
        next.points !== prev.points ? new Date().toISOString() : prev.pointsUpdatedAt;
      loyalty[at] = next;
    }

    profiles[i].loyalty = loyalty;
    profiles[i].updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return profiles[i];
  });
}

export async function deleteLoyalty(profileId, loyaltyId) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1) return null;
    profiles[i].loyalty = (profiles[i].loyalty || []).filter((l) => l.id !== loyaltyId);
    profiles[i].updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return profiles[i];
  });
}

/** Programmes that can actually earn on a given service area. */
export function loyaltyForCategory(profile, category) {
  if (!category) return [];
  return (profile?.loyalty || []).filter((l) => l.category === category);
}

// ---------------------------------------------------------------------------
// Travel agency terms
// ---------------------------------------------------------------------------

export async function setAgency(profileId, agency = {}) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1) return null;
    profiles[i].agency = normalizeAgency({ ...profiles[i].agency, ...agency });
    profiles[i].updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return profiles[i];
  });
}

// ---------------------------------------------------------------------------
// Public-domain enrichment
//
// Research is stored as SUGGESTIONS only. Accepting one is a separate, human
// action — that is the whole point: a magazine profile from 2019 is a lead, not
// a fact about what someone eats today.
// ---------------------------------------------------------------------------

export async function saveEnrichmentSuggestions(profileId, { suggestions = [], summary = "" }) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1) return null;

    const cur = normalizeEnrichment(profiles[i].enrichment);
    const incoming = normalizeEnrichment({ suggestions }).suggestions;

    // Don't resurrect something the user already dismissed, and don't duplicate
    // a suggestion that is already on the list.
    const seen = new Set(
      cur.suggestions.map((s) => `${s.scope}:${s.toolId || ""}:${s.field}:${String(s.value).toLowerCase()}`),
    );
    const fresh = incoming.filter(
      (s) => !seen.has(`${s.scope}:${s.toolId || ""}:${s.field}:${String(s.value).toLowerCase()}`),
    );

    profiles[i].enrichment = {
      lastRunAt: new Date().toISOString(),
      lastSummary: String(summary || ""),
      suggestions: [...cur.suggestions, ...fresh],
    };
    profiles[i].updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return profiles[i];
  });
}

/**
 * Accept or dismiss one researched suggestion. Accepting is the ONLY path from
 * public-domain research into the profile, and it goes through the same
 * additive merge as everything else.
 */
export async function resolveEnrichmentSuggestion(profileId, suggestionId, accept) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1) return null;

    const cur = profiles[i];
    const s = (cur.enrichment?.suggestions || []).find((x) => x.id === suggestionId);
    if (!s) return null;

    if (!accept) {
      s.status = "dismissed";
      cur.updatedAt = new Date().toISOString();
      await writeAll(profiles);
      return cur;
    }

    const tagged = `${s.value} (public source: ${s.source || "web"})`;
    if (s.scope === "tool" && TOOL_IDS.includes(s.toolId)) {
      const bucket = s.field === "notes" ? "notes" : "preferences";
      cur.tools[s.toolId][bucket] = mergeStrings(cur.tools[s.toolId][bucket], [tagged]);
    } else if (s.field.startsWith("brands.")) {
      const key = s.field.slice("brands.".length);
      if (BRAND_FIELDS.includes(key)) {
        cur.brands[key] = mergeStrings(cur.brands[key], [s.value]);
      }
    } else if (s.field === "dietary") {
      cur.dietary = mergeStrings(cur.dietary, [s.value]);
    } else if (s.field === "otherPreferences") {
      cur.otherPreferences = mergeStrings(cur.otherPreferences, [tagged]);
    } else {
      cur.notes = mergeStrings(cur.notes, [tagged]);
    }

    s.status = "accepted";
    cur.updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return cur;
  });
}

/** Replace the preference list for one tool on one profile. */
export async function setToolPreferences(profileId, toolId, preferences) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1 || !TOOL_IDS.includes(toolId)) return null;
    profiles[i].tools[toolId].preferences = mergeStrings([], preferences);
    profiles[i].updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return profiles[i];
  });
}

export async function deleteProfile(id) {
  return serialize(async () => {
    const profiles = await readAll();
    const next = profiles.filter((p) => p.id !== id);
    if (next.length === profiles.length) return false;
    await writeAll(next);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------------

export async function createTour(profileId, name) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1) return null;
    const tour = blankTour(name);
    profiles[i].tours.unshift(tour);
    profiles[i].updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return tour;
  });
}

export async function deleteTour(profileId, tourId) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1) return false;
    const before = profiles[i].tours.length;
    profiles[i].tours = profiles[i].tours.filter((t) => t.id !== tourId);
    if (profiles[i].tours.length === before) return false;
    await writeAll(profiles);
    return true;
  });
}

export async function getThread(profileId, tourId, toolId) {
  const profile = await getProfile(profileId);
  const tour = profile?.tours.find((t) => t.id === tourId);
  if (!tour) return null;
  return tour.threads[toolId] || blankThread();
}

/**
 * Append a turn to a tour+tool thread and fold in whatever the agent decided or
 * considered. This is the tour memory: it is what lets a later message in the
 * same thread know what was already chosen and already ruled out.
 */
export async function appendThreadTurn(profileId, tourId, toolId, turn = {}) {
  return serialize(async () => {
    const profiles = await readAll();
    const pi = profiles.findIndex((p) => p.id === profileId);
    if (pi === -1) return null;
    const ti = profiles[pi].tours.findIndex((t) => t.id === tourId);
    if (ti === -1) return null;

    const tour = profiles[pi].tours[ti];
    const thread = tour.threads[toolId] || blankThread();
    const now = new Date().toISOString();

    for (const m of turn.messages || []) {
      thread.messages.push({ at: now, ...m });
    }
    // Keep threads bounded — the model gets a recent window, not the whole life
    // story, and the file stays a sane size.
    if (thread.messages.length > 60) {
      thread.messages = thread.messages.slice(-60);
    }

    for (const d of turn.decisions || []) {
      const text = String(d || "").trim();
      if (text && !thread.decisions.some((x) => x.text.toLowerCase() === text.toLowerCase())) {
        thread.decisions.push({ at: now, text });
      }
    }

    for (const opt of turn.considered || []) {
      if (!opt?.name) continue;
      const key = opt.name.toLowerCase();
      const existing = thread.considered.find((c) => c.name.toLowerCase() === key);
      if (existing) {
        // Update status if this turn changed it (e.g. considered -> rejected),
        // and fill in any summary detail we didn't have before. A later
        // status-only update must not wipe the stored summary.
        if (opt.status) existing.status = opt.status;
        if (opt.reason) existing.reason = opt.reason;
        for (const f of ["url", "location", "priceTier", "notes"]) {
          if (opt[f]) existing[f] = opt[f];
        }
        if (opt.matches?.length) existing.matches = opt.matches;
        if (opt.allergySafety) existing.allergySafety = opt.allergySafety;
        existing.at = now;
      } else {
        thread.considered.push({
          at: now,
          name: opt.name,
          url: opt.url || "",
          status: opt.status || "considered",
          reason: opt.reason || "",
          location: opt.location || "",
          priceTier: opt.priceTier || "",
          notes: opt.notes || "",
          matches: opt.matches || [],
          allergySafety: opt.allergySafety || null,
        });
      }
    }

    tour.threads[toolId] = thread;
    tour.updatedAt = now;
    profiles[pi].updatedAt = now;
    await writeAll(profiles);
    return thread;
  });
}

/** Manually mark an option chosen/rejected from the UI. */
export async function setOptionStatus(profileId, tourId, toolId, name, status, reason = "") {
  return appendThreadTurn(profileId, tourId, toolId, {
    considered: [{ name, status, reason }],
  });
}

/**
 * What the travel agency has actually cost on this tour.
 *
 * Only confirmed bookings count. A segment the concierge merely proposed has
 * cost nothing, and showing a fee against it would overstate the bill.
 */
export function summariseFees(profile, tour) {
  const agency = normalizeAgency(profile?.agency);
  const rows = Object.values(tour?.confirmations || {});
  const viaAgency = rows.filter((c) => c.channel === BOOKING_CHANNELS.AGENCY);
  const charged = viaAgency.reduce((sum, c) => sum + (Number(c.fee) || 0), 0);

  return {
    currency: agency.currency,
    feePerBooking: agency.feePerBooking,
    agencyBookings: viaAgency.length,
    directBookings: rows.length - viaAgency.length,
    charged,
    // What it would cost to place everything still unbooked through the agency
    // is computed against the live itinerary in server.js, where the segment
    // list is known.
  };
}

/**
 * Everything the master Tour Planner needs to compose one trip: what each
 * specialist thread has locked in and which options were chosen there. This is
 * what makes the planner a *combination* of the other chats rather than a
 * twelfth independent conversation.
 */
export async function getTourSummary(profileId, tourId) {
  const profile = await getProfile(profileId);
  const tour = profile?.tours.find((t) => t.id === tourId);
  if (!tour) return null;

  const areas = [];
  for (const tl of specialistTools()) {
    const thread = tour.threads[tl.id];
    if (!thread) continue;
    const decisions = (thread.decisions || []).map((d) => d.text);
    const chosen = (thread.considered || []).filter((c) => c.status === "chosen");
    const shortlist = (thread.considered || []).filter((c) => c.status === "considered");
    if (!decisions.length && !chosen.length && !shortlist.length) continue;
    areas.push({
      toolId: tl.id,
      label: tl.label,
      decisions,
      chosen: chosen.map((c) => ({
        name: c.name,
        url: c.url,
        location: c.location,
        notes: c.notes,
      })),
      shortlist: shortlist.map((c) => ({ name: c.name, url: c.url, location: c.location })),
    });
  }

  return {
    tourName: tour.name,
    areas,
    itinerary: tour.itinerary || null,
    confirmations: tour.confirmations || {},
    agency: profile.agency,
    fees: summariseFees(profile, tour),
    // Flat list of every option the user has actually chosen in a specialist
    // chat — used to derive whether a segment is merely planned or selected.
    chosenNames: areas.flatMap((a) => a.chosen.map((c) => c.name)),
  };
}

/**
 * Record that the user actually booked a segment. This is the ONLY way a
 * segment becomes "confirmed" — no model output can produce this state.
 *
 * `channel` records HOW it was booked. Booking direct is free; the agency
 * charges its flat fee per booking it places, and that is where the fee total
 * comes from — fees are counted on real bookings, never on proposals.
 */
export async function confirmSegment(
  profileId,
  tourId,
  key,
  reference = "",
  confirmed = true,
  channel = BOOKING_CHANNELS.DIRECT,
) {
  return serialize(async () => {
    const profiles = await readAll();
    const pi = profiles.findIndex((p) => p.id === profileId);
    if (pi === -1) return null;
    const ti = profiles[pi].tours.findIndex((t) => t.id === tourId);
    if (ti === -1) return null;

    const tour = profiles[pi].tours[ti];
    tour.confirmations = tour.confirmations || {};
    if (confirmed) {
      const via =
        channel === BOOKING_CHANNELS.AGENCY ? BOOKING_CHANNELS.AGENCY : BOOKING_CHANNELS.DIRECT;
      const agency = normalizeAgency(profiles[pi].agency);
      tour.confirmations[key] = {
        at: new Date().toISOString(),
        reference: String(reference || "").trim(),
        channel: via,
        // Snapshot the fee that applied at booking time — the agency's terms
        // may change later, but what was charged does not.
        fee: via === BOOKING_CHANNELS.AGENCY ? agency.feePerBooking : 0,
        currency: agency.currency,
      };
    } else {
      delete tour.confirmations[key];
    }
    tour.updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return tour.confirmations;
  });
}

/** Persist the plan the master planner produced for this tour. */
export async function saveItinerary(profileId, tourId, itinerary) {
  return serialize(async () => {
    const profiles = await readAll();
    const pi = profiles.findIndex((p) => p.id === profileId);
    if (pi === -1) return null;
    const ti = profiles[pi].tours.findIndex((t) => t.id === tourId);
    if (ti === -1) return null;
    profiles[pi].tours[ti].itinerary = { ...itinerary, updatedAt: new Date().toISOString() };
    profiles[pi].tours[ti].updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return {
      itinerary: profiles[pi].tours[ti].itinerary,
      confirmations: profiles[pi].tours[ti].confirmations || {},
    };
  });
}

// ---------------------------------------------------------------------------
// Continuous learning
//
// Additive by design — learning never removes a stored constraint, because a
// single ambiguous sentence should not be able to erase a standing allergy.
// Global facts go on the profile; tool-specific facts go on that tool only.
// ---------------------------------------------------------------------------

export async function mergeLearnings(profileId, toolId, learnings = {}) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === profileId);
    if (i === -1) return null;

    const cur = profiles[i];
    const g = learnings.global || {};
    const t = learnings.tool || {};

    cur.dietary = mergeStrings(cur.dietary, g.dietary);
    cur.allergies = mergeAllergies(cur.allergies, g.allergies);
    cur.otherPreferences = mergeStrings(cur.otherPreferences, g.otherPreferences);
    cur.notes = mergeStrings(cur.notes, g.notes);

    // Supplier loyalty stated in conversation ("we're a Hilton family") is a
    // durable brand preference, so it lands on the profile like any other.
    for (const f of BRAND_FIELDS) {
      cur.brands[f] = mergeStrings(cur.brands[f], g.brands?.[f]);
    }

    // Constraints picked up about a NAMED travelling companion go on that
    // person, not on the artist — matched by name, and never creating someone
    // the user never entered.
    for (const upd of learnings.party || []) {
      const name = String(upd?.name || "").trim().toLowerCase();
      if (!name) continue;
      const member = (cur.party || []).find((m) => m.name.toLowerCase() === name);
      if (!member) continue; // party membership is entered by a human, not inferred
      member.dietary = mergeStrings(member.dietary, upd.dietary);
      member.allergies = mergeAllergies(member.allergies, upd.allergies);
      member.preferences = mergeStrings(member.preferences, upd.preferences);
      member.notes = mergeStrings(member.notes, upd.notes);
    }

    if (TOOL_IDS.includes(toolId)) {
      cur.tools[toolId].preferences = mergeStrings(cur.tools[toolId].preferences, t.preferences);
      cur.tools[toolId].notes = mergeStrings(cur.tools[toolId].notes, t.notes);
    }

    cur.updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return cur;
  });
}
