// Preference store.
//
// Shape:
//   Profile (a person)
//     ├── global constraints (dietary, allergies, preferences, learned notes)
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
import { TOOL_IDS, specialistTools, getTool } from "./tools.js";

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
    tools,
    tours: [],
  };
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
      updatedAt: new Date().toISOString(),
    };
    await writeAll(profiles);
    return profiles[i];
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
    // Flat list of every option the user has actually chosen in a specialist
    // chat — used to derive whether a segment is merely planned or selected.
    chosenNames: areas.flatMap((a) => a.chosen.map((c) => c.name)),
  };
}

/**
 * Record that the user actually booked a segment. This is the ONLY way a
 * segment becomes "confirmed" — no model output can produce this state.
 * Pass `null` as reference to clear a confirmation.
 */
export async function confirmSegment(profileId, tourId, key, reference = "", confirmed = true) {
  return serialize(async () => {
    const profiles = await readAll();
    const pi = profiles.findIndex((p) => p.id === profileId);
    if (pi === -1) return null;
    const ti = profiles[pi].tours.findIndex((t) => t.id === tourId);
    if (ti === -1) return null;

    const tour = profiles[pi].tours[ti];
    tour.confirmations = tour.confirmations || {};
    if (confirmed) {
      tour.confirmations[key] = {
        at: new Date().toISOString(),
        reference: String(reference || "").trim(),
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

    if (TOOL_IDS.includes(toolId)) {
      cur.tools[toolId].preferences = mergeStrings(cur.tools[toolId].preferences, t.preferences);
      cur.tools[toolId].notes = mergeStrings(cur.tools[toolId].notes, t.notes);
    }

    cur.updatedAt = new Date().toISOString();
    await writeAll(profiles);
    return cur;
  });
}
