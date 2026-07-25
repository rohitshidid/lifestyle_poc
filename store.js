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
import { TOOL_IDS } from "./tools.js";

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
    considered: [], // {at, name, url, status, reason} — options already seen
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
    tools,
    tours: (p.tours || []).map((t) => ({
      ...blankTour(t.name),
      ...t,
      threads: t.threads || {},
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
        // Update status if this turn changed it (e.g. considered -> rejected).
        if (opt.status) existing.status = opt.status;
        if (opt.reason) existing.reason = opt.reason;
        existing.at = now;
      } else {
        thread.considered.push({
          at: now,
          name: opt.name,
          url: opt.url || "",
          status: opt.status || "considered",
          reason: opt.reason || "",
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
