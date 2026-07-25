/* IHMS Concierge — client.
 *
 * State hierarchy mirrors the server:
 *   person (profile) -> tour -> service area (tool) -> thread
 * The active triple is what every request is scoped to.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );

let TOOLS = [];
let profiles = [];
let activeProfileId = localStorage.getItem("ihms.profile") || null;
let activeTourId = localStorage.getItem("ihms.tour") || null;
let activeToolId = localStorage.getItem("ihms.tool") || "hotel";
let activeThread = { messages: [], decisions: [], considered: [] };

const profile = () => profiles.find((p) => p.id === activeProfileId) || null;
const tour = () => profile()?.tours.find((t) => t.id === activeTourId) || null;
const tool = () => TOOLS.find((t) => t.id === activeToolId) || TOOLS[0] || null;

/* ============================================================ chip editor */

/**
 * A chip editor: existing values render as removable pills, and typing +
 * Enter (or comma) adds a new one. This replaces the old single-line
 * comma-separated text field, which overflowed as soon as you had more than
 * two preferences.
 */
function chipEditor(mount, { items = [], placeholder = "", cls = "", parse, render }) {
  const el = typeof mount === "string" ? $(mount) : mount;
  let values = [...items];

  const paint = () => {
    el.innerHTML = `
      <div class="chip-editor">
        <div class="chips"></div>
        <input type="text" placeholder="${esc(placeholder)}" />
      </div>`;
    const chips = el.querySelector(".chips");
    values.forEach((v, i) => {
      const label = render ? render(v) : v;
      const extra = cls === "allergy" && /severe/i.test(label) ? " sev-severe" : "";
      const chip = document.createElement("span");
      chip.className = `chip ${cls}${extra}`;
      chip.innerHTML = `<span class="txt">${esc(label)}</span><span class="x" title="Remove">×</span>`;
      chip.querySelector(".x").onclick = () => {
        values.splice(i, 1);
        paint();
      };
      chips.appendChild(chip);
    });

    const input = el.querySelector("input");
    input.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const raw = input.value.trim().replace(/,$/, "");
        if (!raw) return;
        const parsed = parse ? parse(raw) : raw;
        if (parsed) values.push(parsed);
        input.value = "";
        paint();
        el.querySelector("input").focus();
      } else if (e.key === "Backspace" && !input.value && values.length) {
        values.pop();
        paint();
        el.querySelector("input").focus();
      }
    };
  };

  paint();
  return {
    get: () => values,
    set: (next) => {
      values = [...next];
      paint();
    },
  };
}

const parseAllergy = (raw) => {
  const [name, severity] = raw.split(":").map((x) => (x || "").trim());
  return name ? { name, severity: severity || "unknown" } : null;
};
const renderAllergy = (a) => `${a.name} · ${a.severity}`;

let dietEd, allergyEd, prefEd, toolPrefEd;

/* ============================================================== rendering */

function renderToolTabs() {
  const wrap = $("tooltabs");
  wrap.innerHTML = "";
  const t = tour();
  for (const tl of TOOLS) {
    const hasActivity = !!t?.threads?.[tl.id]?.messages?.length;
    const b = document.createElement("button");
    b.className = "tooltab" + (tl.id === activeToolId ? " active" : "");
    b.innerHTML = `<span>${tl.icon}</span><span>${esc(tl.label)}</span>${
      hasActivity ? '<span class="dot"></span>' : ""
    }`;
    b.onclick = () => selectTool(tl.id);
    wrap.appendChild(b);
  }
}

function renderContextStrip() {
  const p = profile();
  const t = tour();
  const tl = tool();
  const el = $("contextStrip");

  if (!p) {
    el.innerHTML = `<span>No person selected — add one on the right to begin.</span>`;
    return;
  }
  const allergies = (p.allergies || []).map((a) => `${a.name} (${a.severity})`).join(", ");
  el.innerHTML = `
    <span><strong>${esc(p.name)}</strong></span>
    <span class="sep">/</span>
    <span>${t ? `<strong>${esc(t.name)}</strong>` : "<em>no tour selected</em>"}</span>
    <span class="sep">/</span>
    <span>${tl ? `${tl.icon} <strong>${esc(tl.label)}</strong>` : ""}</span>
    ${allergies ? `<span class="sep">/</span><span class="allergy-flag">⚠ ${esc(allergies)}</span>` : ""}
  `;
}

function renderThread() {
  const box = $("thread");
  const msgs = activeThread.messages || [];
  box.innerHTML = "";
  $("threadEmpty").classList.toggle("hidden", msgs.length > 0);

  for (const m of msgs) {
    const div = document.createElement("div");
    div.className = "msg " + (m.role === "user" ? "user" : "agent");
    div.innerHTML = `
      <div class="who">${m.role === "user" ? "You" : "IH"}</div>
      <div class="body">${esc(m.text)}</div>`;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

function renderMemory() {
  const dec = activeThread.decisions || [];
  $("decisions").innerHTML = dec.length
    ? dec
        .map(
          (d) =>
            `<div class="memory-item">${esc(d.text)}<div class="when">${new Date(
              d.at,
            ).toLocaleString()}</div></div>`,
        )
        .join("")
    : '<div class="hint">Nothing locked in yet for this tour + service.</div>';

  const con = activeThread.considered || [];
  $("considered").innerHTML = con.length
    ? con
        .map(
          (c) => `
      <div class="considered-item">
        <span class="nm" title="${esc(c.name)}">${esc(c.name)}</span>
        <span class="row tight">
          <span class="status-badge ${esc(c.status)}">${esc(c.status)}</span>
          ${
            c.status !== "chosen"
              ? `<button class="ghost xs" data-mark="chosen" data-name="${esc(c.name)}">Choose</button>`
              : ""
          }
          ${
            c.status !== "rejected"
              ? `<button class="ghost xs" data-mark="rejected" data-name="${esc(c.name)}">Reject</button>`
              : ""
          }
        </span>
      </div>`,
        )
        .join("")
    : '<div class="hint">No options considered yet.</div>';

  $("considered")
    .querySelectorAll("button[data-mark]")
    .forEach((b) => {
      b.onclick = () => markOption(b.dataset.name, b.dataset.mark);
    });
}

function renderSidebar() {
  // Person dropdown
  const psel = $("profileSelect");
  psel.innerHTML = profiles.length
    ? profiles.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")
    : `<option value="">— no people yet —</option>`;
  if (activeProfileId) psel.value = activeProfileId;

  const p = profile();
  const hasProfile = !!p;
  ["tourCard", "toolPrefCard", "memoryCard", "globalCard"].forEach((id) =>
    $(id).classList.toggle("hidden", !hasProfile),
  );
  if (!hasProfile) return;

  // Tour dropdown
  const tsel = $("tourSelect");
  tsel.innerHTML = p.tours.length
    ? p.tours.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")
    : `<option value="">— no tours yet —</option>`;
  if (activeTourId) tsel.value = activeTourId;

  // Global fields
  $("pName").value = p.name;
  dietEd = chipEditor("dietEditor", {
    items: p.dietary || [],
    placeholder: "vegan, gluten-free…",
    cls: "diet",
  });
  allergyEd = chipEditor("allergyEditor", {
    items: p.allergies || [],
    placeholder: "tree nuts:severe…",
    cls: "allergy",
    parse: parseAllergy,
    render: renderAllergy,
  });
  prefEd = chipEditor("prefEditor", {
    items: p.otherPreferences || [],
    placeholder: "quiet room, no early flights…",
  });

  $("globalNotes").innerHTML = (p.notes || []).length
    ? p.notes.map((n) => `<div class="memory-item">${esc(n)}</div>`).join("")
    : '<div class="hint">Nothing learned yet — the system fills this in as you chat.</div>';

  // Tool-specific
  const tl = tool();
  if (tl) {
    $("toolPrefHeading").textContent = `${tl.icon} ${tl.label} preferences`;
    $("toolPrefHint").textContent = `e.g. ${tl.prefHint}`;
    toolPrefEd = chipEditor("toolPrefEditor", {
      items: p.tools?.[tl.id]?.preferences || [],
      placeholder: "Add a preference…",
    });
    const tnotes = p.tools?.[tl.id]?.notes || [];
    $("toolNotes").innerHTML = tnotes.length
      ? tnotes.map((n) => `<div class="memory-item">${esc(n)}</div>`).join("")
      : '<div class="hint">Nothing learned for this service yet.</div>';
  }

  const tl2 = tool();
  $("toolHeading").textContent = tl2 ? `${tl2.icon} ${tl2.label}` : "Conversation";
  $("message").placeholder = tl2?.placeholder || "Describe what you need…";
}

function renderAll() {
  renderToolTabs();
  renderContextStrip();
  renderSidebar();
  renderThread();
  renderMemory();
}

/* ================================================================= data */

async function loadProfiles() {
  profiles = await (await fetch("/api/profiles")).json();
  if (!profiles.find((p) => p.id === activeProfileId)) {
    activeProfileId = profiles[0]?.id || null;
    localStorage.setItem("ihms.profile", activeProfileId || "");
  }
  const p = profile();
  if (p && !p.tours.find((t) => t.id === activeTourId)) {
    activeTourId = p.tours[0]?.id || null;
    localStorage.setItem("ihms.tour", activeTourId || "");
  }
  await loadThread();
}

async function loadThread() {
  activeThread = { messages: [], decisions: [], considered: [] };
  if (activeProfileId && activeTourId && activeToolId) {
    const r = await fetch(
      `/api/profiles/${activeProfileId}/tours/${activeTourId}/threads/${activeToolId}`,
    );
    if (r.ok) activeThread = await r.json();
  }
  renderAll();
}

/* =============================================================== actions */

function selectTool(id) {
  activeToolId = id;
  localStorage.setItem("ihms.tool", id);
  $("resultsCard").classList.add("hidden");
  loadThread();
}

$("profileSelect").onchange = (e) => {
  activeProfileId = e.target.value || null;
  localStorage.setItem("ihms.profile", activeProfileId || "");
  const p = profile();
  activeTourId = p?.tours[0]?.id || null;
  localStorage.setItem("ihms.tour", activeTourId || "");
  $("resultsCard").classList.add("hidden");
  loadThread();
};

$("tourSelect").onchange = (e) => {
  activeTourId = e.target.value || null;
  localStorage.setItem("ihms.tour", activeTourId || "");
  $("resultsCard").classList.add("hidden");
  loadThread();
};

$("createProfile").onclick = async () => {
  const name = $("newProfileName").value.trim();
  if (!name) return $("newProfileName").focus();
  const r = await fetch("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const p = await r.json();
  $("newProfileName").value = "";
  activeProfileId = p.id;
  activeTourId = null;
  localStorage.setItem("ihms.profile", p.id);
  await loadProfiles();
};

$("createTour").onclick = async () => {
  const name = $("newTourName").value.trim();
  if (!name || !activeProfileId) return $("newTourName").focus();
  const r = await fetch(`/api/profiles/${activeProfileId}/tours`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const t = await r.json();
  $("newTourName").value = "";
  activeTourId = t.id;
  localStorage.setItem("ihms.tour", t.id);
  await loadProfiles();
};

$("deleteTour").onclick = async () => {
  const t = tour();
  if (!t || !confirm(`Delete tour "${t.name}" and all its conversations?`)) return;
  await fetch(`/api/profiles/${activeProfileId}/tours/${t.id}`, { method: "DELETE" });
  activeTourId = null;
  await loadProfiles();
};

$("saveProfile").onclick = async () => {
  if (!activeProfileId) return;
  await fetch(`/api/profiles/${activeProfileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: $("pName").value,
      dietary: dietEd.get(),
      allergies: allergyEd.get(),
      otherPreferences: prefEd.get(),
    }),
  });
  flash("saveMsg", "Saved.");
  await loadProfiles();
};

$("deleteProfile").onclick = async () => {
  const p = profile();
  if (!p || !confirm(`Delete "${p.name}" and every tour under them?`)) return;
  await fetch(`/api/profiles/${p.id}`, { method: "DELETE" });
  activeProfileId = null;
  activeTourId = null;
  await loadProfiles();
};

$("saveToolPrefs").onclick = async () => {
  if (!activeProfileId || !activeToolId) return;
  await fetch(`/api/profiles/${activeProfileId}/tools/${activeToolId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferences: toolPrefEd.get() }),
  });
  flash("toolPrefMsg", "Saved.");
  await loadProfiles();
};

async function markOption(name, status) {
  await fetch(
    `/api/profiles/${activeProfileId}/tours/${activeTourId}/threads/${activeToolId}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, status }),
    },
  );
  await loadThread();
}

function flash(id, msg) {
  $(id).textContent = msg;
  setTimeout(() => ($(id).textContent = ""), 1800);
}

/* ================================================================== chat */

$("send").onclick = send;
$("message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
});

async function send() {
  const message = $("message").value.trim();
  if (!message) return $("message").focus();
  if (!activeProfileId || !activeTourId) {
    $("status").innerHTML = '<span class="error">Select a person and a tour first.</span>';
    return;
  }

  // Optimistic echo so the thread feels live.
  activeThread.messages = [...(activeThread.messages || []), { role: "user", text: message }];
  renderThread();
  $("message").value = "";
  $("send").disabled = true;
  $("status").innerHTML = '<span class="spinner-line"><span class="pulse"></span>Thinking & searching…</span>';

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: activeProfileId,
        tourId: activeTourId,
        toolId: activeToolId,
        message,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Request failed");

    if (data.thread) activeThread = data.thread;
    renderOptions(data);
    $("status").textContent = "";
    await loadProfiles();
  } catch (e) {
    $("status").innerHTML = `<span class="error">${esc(e.message)}</span>`;
    renderThread();
  } finally {
    $("send").disabled = false;
  }
}

function renderOptions(data) {
  const opts = data.options || [];
  const card = $("resultsCard");
  const banner = $("banner");
  const wrap = $("options");

  const w = data.allergyWatch || {};
  const superseded = data.supersededDecisions || [];

  let bannerHtml = "";
  if (superseded.length) {
    bannerHtml += `<div class="banner info">↻ Plan updated — superseded: ${superseded
      .map(esc)
      .join("; ")}</div>`;
  }
  if (w.inScope && opts.length) {
    const severe = w.severe?.length ? ` Severe: <strong>${w.severe.map(esc).join(", ")}</strong>.` : "";
    bannerHtml += `<div class="banner">⚠️ Allergy check active for
      <strong>${w.active.map((a) => esc(a.name)).join(", ")}</strong>.${severe}
      ${w.unverifiedCount} of ${opts.length} options have no published allergen information —
      confirm with the property before booking.</div>`;
  }
  banner.innerHTML = bannerHtml;

  if (!opts.length && !bannerHtml) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");

  const chosen = new Set(
    (activeThread.considered || []).filter((c) => c.status === "chosen").map((c) => c.name.toLowerCase()),
  );

  wrap.innerHTML = opts.length
    ? opts
        .map((o) => {
          const s = o.allergySafety || { status: "not_applicable", note: "" };
          const label = {
            verified: "✓ Allergen policy found",
            unverified: "⚠ Allergen info unverified",
            risk: "✕ Possible allergen conflict",
            not_applicable: "Allergy check not applicable",
          }[s.status] || s.status;
          const isChosen = chosen.has(String(o.name).toLowerCase());
          return `
      <div class="option ${s.status === "risk" ? "risk" : ""} ${isChosen ? "chosen" : ""}">
        <h3>${
          o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name)}</a>` : esc(o.name)
        }</h3>
        <div class="meta">${esc(o.location || "")} ${
          o.priceTier ? `· <span class="tier">${esc(o.priceTier)}</span>` : ""
        }</div>
        <div class="chip-editor" style="border:none;background:none;padding:0;">
          <div class="chips">${(o.matches || [])
            .map((m) => `<span class="chip readonly">${esc(m)}</span>`)
            .join("")}</div>
        </div>
        <div><span class="safety ${esc(s.status)}">${label}</span></div>
        ${s.note ? `<div class="safety-note">${esc(s.note)}</div>` : ""}
        ${o.notes ? `<p class="notes">${esc(o.notes)}</p>` : ""}
        <div class="row tight" style="margin-top:10px;">
          <button class="ghost xs" data-mark="chosen" data-name="${esc(o.name)}">Choose</button>
          <button class="ghost xs" data-mark="rejected" data-name="${esc(o.name)}">Reject</button>
        </div>
      </div>`;
        })
        .join("")
    : "";

  wrap.querySelectorAll("button[data-mark]").forEach((b) => {
    b.onclick = () => markOption(b.dataset.name, b.dataset.mark);
  });
}

/* ================================================================== init */

(async function init() {
  TOOLS = await (await fetch("/api/tools")).json();
  if (!TOOLS.find((t) => t.id === activeToolId)) activeToolId = TOOLS[0]?.id;
  await loadProfiles();
})();
