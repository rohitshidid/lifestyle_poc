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
let META = { partyRoles: [], loyaltyCategories: [] };
let profiles = [];
// Which party member / loyalty programme the sidebar form is currently editing
// (null = the form is adding a new one).
let editingPartyId = null;
let editingLoyaltyId = null;
// Segments ticked for a single bundled agency instruction. Bundling matters:
// the fee is per booking placed, so one instruction covering six segments is
// still six fees — but one conversation.
let briefSelection = new Set();
let lastItinerary = null;
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
let pmDietEd, pmAllergyEd, pmPrefEd;
let brandEds = {};

/* ================================================================== modal */

/**
 * A small promise-returning dialog. Replaces window.prompt for confirming a
 * booking, because the booking channel is a real choice with a cost attached
 * and a text prompt cannot express it.
 */
function modal({ title, body, okLabel = "Confirm" }) {
  return new Promise((resolve) => {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = body;
    $("modalOk").textContent = okLabel;
    $("modal").classList.remove("hidden");

    const close = (value) => {
      $("modal").classList.add("hidden");
      $("modalOk").onclick = null;
      $("modalCancel").onclick = null;
      resolve(value);
    };
    $("modalOk").onclick = () => close($("modalBody"));
    $("modalCancel").onclick = () => close(null);
    $("modal").onclick = (e) => {
      if (e.target === $("modal")) close(null);
    };
  });
}

/* ============================================================== rendering */

function renderToolTabs() {
  const wrap = $("tooltabs");
  wrap.innerHTML = "";
  const t = tour();
  for (const tl of TOOLS) {
    const hasActivity = !!t?.threads?.[tl.id]?.messages?.length;
    const b = document.createElement("button");
    b.className =
      "tooltab" + (tl.master ? " master" : "") + (tl.id === activeToolId ? " active" : "");
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

  // Considered options are expandable: the summary written when the option was
  // first suggested is stored with it, so it can be re-read without asking the
  // model again.
  const con = activeThread.considered || [];
  $("considered").innerHTML = con.length
    ? con
        .map((c, i) => {
          const s = c.allergySafety;
          const safetyLabel = s
            ? {
                verified: "✓ Allergen policy found",
                unverified: "⚠ Allergen info unverified",
                risk: "✕ Possible allergen conflict",
                not_applicable: "Allergy check n/a",
              }[s.status] || s.status
            : null;
          return `
      <div class="considered-item" data-idx="${i}">
        <div class="ci-head" role="button" tabindex="0">
          <span class="ci-caret">▸</span>
          <span class="nm" title="${esc(c.name)}">${esc(c.name)}</span>
          <span class="status-badge ${esc(c.status)}">${esc(c.status)}</span>
        </div>
        <div class="ci-body hidden">
          ${
            c.location || c.priceTier
              ? `<div class="ci-meta">${esc(c.location || "")}${
                  c.priceTier ? ` · <span class="tier">${esc(c.priceTier)}</span>` : ""
                }</div>`
              : ""
          }
          ${c.notes ? `<p class="ci-notes">${esc(c.notes)}</p>` : ""}
          ${
            (c.matches || []).length
              ? `<div class="chips">${c.matches
                  .map((m) => `<span class="chip readonly">${esc(m)}</span>`)
                  .join("")}</div>`
              : ""
          }
          ${safetyLabel ? `<div class="safety ${esc(s.status)}">${safetyLabel}</div>` : ""}
          ${s?.note ? `<div class="safety-note">${esc(s.note)}</div>` : ""}
          ${c.reason ? `<div class="ci-reason">Reason: ${esc(c.reason)}</div>` : ""}
          ${
            !c.notes && !(c.matches || []).length && !c.location
              ? '<div class="hint">No summary stored for this option.</div>'
              : ""
          }
          <div class="row tight" style="margin-top:9px;">
            ${
              c.url
                ? `<a class="ci-link" href="${esc(c.url)}" target="_blank" rel="noopener">Open ↗</a>`
                : ""
            }
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
          </div>
        </div>
      </div>`;
        })
        .join("")
    : '<div class="hint">No options considered yet.</div>';

  $("considered")
    .querySelectorAll(".ci-head")
    .forEach((head) => {
      const toggle = () => {
        const item = head.closest(".considered-item");
        item.querySelector(".ci-body").classList.toggle("hidden");
        head.querySelector(".ci-caret").textContent = item
          .querySelector(".ci-body")
          .classList.contains("hidden")
          ? "▸"
          : "▾";
      };
      head.onclick = toggle;
      head.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      };
    });

  $("considered")
    .querySelectorAll("button[data-mark]")
    .forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        markOption(b.dataset.name, b.dataset.mark);
      };
    });
}

/* ============================================================= itinerary */

/**
 * What the agency has cost and what it would cost. Only confirmed bookings are
 * charged — a proposal has cost nothing, and showing a fee against one would
 * overstate the bill.
 */
function renderFeeBar(fees) {
  const bar = $("feeBar");
  if (!fees || !fees.agencyEnabled) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  const money = (n) => `${fees.currency} ${Number(n || 0).toLocaleString()}`;
  bar.innerHTML = `
    <div class="fee-row">
      <span class="fee-num">${money(fees.charged)}</span>
      <span class="fee-label">agency fees on booked segments —
        ${fees.agencyBookings} via ${esc(fees.agencyName)},
        ${fees.directBookings} booked direct at no fee</span>
    </div>
    ${
      fees.recommendedOpen
        ? `<div class="fee-note">${fees.recommendedOpen} unbooked segment${
            fees.recommendedOpen === 1 ? " is" : "s are"
          } worth handing to the agency — ${money(fees.feePerBooking)} each,
          taking the total to ${money(fees.projectedIfAgencyRecsTaken)} if you use it for all of them.</div>`
        : `<div class="fee-note">Nothing outstanding needs the agency — the direct links are free.</div>`
    }`;
}

/** Bundle the ticked segments into one instruction the user can send. */
function renderBriefBar(fees) {
  const bar = $("agencyBriefBar");
  if (!briefSelection.size || !fees?.agencyEnabled) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  const n = briefSelection.size;
  bar.classList.remove("hidden");
  bar.innerHTML = `
    <div class="brief-bar">
      <span>${n} segment${n === 1 ? "" : "s"} selected —
        ${esc(fees.currency)} ${(fees.feePerBooking * n).toLocaleString()} in agency fees
        (${esc(fees.currency)} ${fees.feePerBooking} × ${n} bookings)</span>
      <span class="row tight">
        <button class="sm" id="buildBrief">Compose agency request</button>
        <button class="ghost xs" id="clearBrief">Clear</button>
      </span>
    </div>`;
  $("buildBrief").onclick = composeAgencyBrief;
  $("clearBrief").onclick = () => {
    briefSelection.clear();
    renderItinerary(lastItinerary);
  };
}

async function composeAgencyBrief() {
  const r = await fetch(`/api/profiles/${activeProfileId}/tours/${activeTourId}/agency-brief`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentKeys: [...briefSelection] }),
  });
  const data = await r.json();
  if (!r.ok) return alert(data.error || "Could not compose the request.");

  const result = await modal({
    title: `Send to ${data.agencyName}`,
    okLabel: "Copy to clipboard",
    body: `
      <div class="hint">
        ${esc(data.segmentCount)} booking${data.segmentCount === 1 ? "" : "s"} —
        ${esc(data.currency)} ${data.fee} in fees.
        ${data.agencyContact ? `Send to <strong>${esc(data.agencyContact)}</strong>.` : ""}
        Nothing is booked until they confirm and you mark it here.
      </div>
      <textarea id="briefText" class="brief-text" rows="16">${esc(data.brief)}</textarea>`,
  });
  if (!result) return;
  try {
    await navigator.clipboard.writeText($("briefText").value);
  } catch {
    /* clipboard blocked — the text is still on screen to copy by hand */
  }
}

function renderItinerary(it) {
  lastItinerary = it;
  const card = $("itineraryCard");
  if (!it || !(it.days || []).length) {
    if (!it?.gaps?.length && !it?.logistics?.length) {
      card.classList.add("hidden");
      return;
    }
  }
  card.classList.remove("hidden");
  $("itineraryTitle").textContent = it.title || "Tour itinerary";

  // The app cannot make reservations. Say so plainly rather than letting a
  // status badge imply otherwise.
  $("itineraryDisclaimer").innerHTML =
    "This is a plan, not a set of reservations — nothing here is booked until you book it and mark it. Use the links to book directly.";

  const typeIcon = {
    flights: "✈️", transport: "🚐", hotel: "🏨", dining: "🍽️", catering: "🥗",
    courier: "📦", venue: "🎤", wellness: "🧘", medical: "⚕️", grocery: "🛒",
    downtime: "🎧", other: "•",
  };

  // Booking state is derived server-side from what the user actually did.
  // "confirmed" only ever means the user pressed Mark as booked.
  const badge = {
    confirmed: { label: "booked by you", cls: "confirmed" },
    selected: { label: "your pick — not booked", cls: "selected" },
    planned: { label: "suggested", cls: "" },
  };

  $("itineraryDays").innerHTML = (it.days || [])
    .map(
      (d) => `
    <div class="day">
      <div class="day-head">
        <span class="day-name">${esc(d.day)}</span>
        ${d.city ? `<span class="day-city">${esc(d.city)}</span>` : ""}
      </div>
      ${(d.segments || [])
        .map((s) => {
          const b = badge[s.status] || badge.planned;
          return `
        <div class="seg ${esc(s.status || "planned")}">
          <div class="seg-time">${esc(s.time || "TBC")}</div>
          <div class="seg-body">
            <div class="seg-title">
              <span class="seg-icon">${typeIcon[s.type] || "•"}</span>
              ${
                s.url
                  ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`
                  : esc(s.title)
              }
              <span class="status-badge ${b.cls}">${b.label}</span>
            </div>
            ${
              s.location || s.provider
                ? `<div class="seg-meta">${esc(s.location || "")}${
                    s.provider ? ` · ${esc(s.provider)}` : ""
                  }</div>`
                : ""
            }
            ${s.carrying ? `<div class="seg-carry">📦 Carrying: ${esc(s.carrying)}</div>` : ""}
            ${s.party ? `<div class="seg-party">👥 ${esc(s.party)}</div>` : ""}
            ${
              s.loyalty?.program
                ? `<div class="seg-loyalty">★ ${esc(s.loyalty.program)}${
                    s.loyalty.tier ? ` · ${esc(s.loyalty.tier)}` : ""
                  }${
                    s.loyalty.earns === "yes"
                      ? " — earns here"
                      : s.loyalty.earns === "unknown"
                        ? " — earning unconfirmed"
                        : ""
                  }${s.loyalty.tierBenefit ? ` · ${esc(s.loyalty.tierBenefit)}` : ""}</div>`
                : ""
            }
            ${s.notes ? `<div class="seg-notes">${esc(s.notes)}</div>` : ""}
            ${
              s.status === "confirmed"
                ? `<div class="seg-ref">Booked ${
                    s.bookedVia === "agency"
                      ? `via the agency${s.feeCharged ? ` — fee ${esc(it.fees?.currency || "")} ${s.feeCharged}` : ""}`
                      : "direct — no fee"
                  }${s.reference ? ` · Ref: ${esc(s.reference)}` : ""}</div>`
                : ""
            }
            ${
              s.status !== "confirmed" && s.agency?.recommended
                ? `<div class="seg-agency-rec">🏷 Worth handing to the agency (${esc(
                    s.agency.currency,
                  )} ${s.agency.fee})${s.agency.reason ? ` — ${esc(s.agency.reason)}` : ""}</div>`
                : ""
            }
            <div class="row tight" style="margin-top:7px;">
              ${
                s.status === "confirmed"
                  ? `<button class="ghost xs" data-unconfirm="${esc(s.segmentKey)}">Undo booked</button>`
                  : `<button class="ghost xs" data-confirm="${esc(s.segmentKey)}">Mark as booked</button>`
              }
              ${
                s.url
                  ? `<a class="ci-link" href="${esc(s.url)}" target="_blank" rel="noopener">Book direct ↗ (free)</a>`
                  : ""
              }
              ${
                s.status !== "confirmed" && s.agency?.available
                  ? `<label class="brief-check"><input type="checkbox" data-brief="${esc(
                      s.segmentKey,
                    )}" ${briefSelection.has(s.segmentKey) ? "checked" : ""} /> send to agency</label>`
                  : ""
              }
            </div>
          </div>
        </div>`;
        })
        .join("")}
    </div>`,
    )
    .join("");

  renderFeeBar(it.fees);
  renderBriefBar(it.fees);

  $("itineraryDays")
    .querySelectorAll("input[data-brief]")
    .forEach((c) => {
      c.onchange = () => {
        if (c.checked) briefSelection.add(c.dataset.brief);
        else briefSelection.delete(c.dataset.brief);
        renderBriefBar(it.fees);
      };
    });

  $("itineraryDays")
    .querySelectorAll("button[data-confirm]")
    .forEach((b) => {
      b.onclick = async () => {
        const fee = it.fees || {};
        const box = await modal({
          title: "Mark as booked",
          okLabel: "Mark as booked",
          body: `
            <div class="hint">Only mark this once the booking actually exists.</div>
            <div class="field" style="margin-top:10px;">
              <span class="field-label">How was it booked?</span>
              <label class="check"><input type="radio" name="chan" value="direct" checked />
                Direct — no fee</label>
              <label class="check"><input type="radio" name="chan" value="agency"
                ${fee.agencyEnabled ? "" : "disabled"} />
                Through ${esc(fee.agencyName || "the agency")}${
                  fee.agencyEnabled ? ` — ${esc(fee.currency)} ${fee.feePerBooking} fee` : " (not enabled)"
                }</label>
            </div>
            <div class="field">
              <label class="field-label" for="confRef">Booking reference (optional)</label>
              <input type="text" id="confRef" placeholder="ABC123" />
            </div>`,
        });
        if (!box) return;
        const channel = box.querySelector('input[name="chan"]:checked')?.value || "direct";
        await confirmSegment(b.dataset.confirm, box.querySelector("#confRef").value, true, channel);
      };
    });

  $("itineraryDays")
    .querySelectorAll("button[data-unconfirm]")
    .forEach((b) => {
      b.onclick = () => confirmSegment(b.dataset.unconfirm, "", false);
    });

  const logi = it.logistics || [];
  $("logisticsBlock").innerHTML = logi.length
    ? `<h3 class="sub-head">📦 What moves between cities</h3>` +
      logi
        .map(
          (l) => `
      <div class="logi">
        <div class="logi-item">${esc(l.item)}</div>
        <div class="logi-route">${esc(l.from || "?")} → ${esc(l.to || "?")}</div>
        <div class="logi-meta">
          ${l.method ? `${esc(l.method)}` : ""}${l.provider ? ` · ${esc(l.provider)}` : ""}
          ${l.collect ? ` · collect ${esc(l.collect)}` : ""}${
            l.arrive ? ` · arrive ${esc(l.arrive)}` : ""
          }
        </div>
        ${l.notes ? `<div class="seg-notes">${esc(l.notes)}</div>` : ""}
        ${
          l.url
            ? `<a class="ci-link" href="${esc(l.url)}" target="_blank" rel="noopener">Book ↗</a>`
            : ""
        }
      </div>`,
        )
        .join("")
    : "";

  const gaps = it.gaps || [];
  $("gapsBlock").innerHTML = gaps.length
    ? `<h3 class="sub-head">⚠ Still to sort</h3>` +
      gaps.map((g) => `<div class="gap">${esc(g)}</div>`).join("")
    : "";
}

/* ==================================================== party / loyalty / agency */

function renderParty(p) {
  const party = p.party || [];
  $("partyList").innerHTML = party.length
    ? party
        .map((m) => {
          const sev = (m.allergies || []).some((a) => a.severity === "severe");
          const bits = [
            ...(m.dietary || []).map((d) => `<span class="chip readonly diet">${esc(d)}</span>`),
            ...(m.allergies || []).map(
              (a) =>
                `<span class="chip readonly allergy${
                  a.severity === "severe" ? " sev-severe" : ""
                }">⚠ ${esc(a.name)} · ${esc(a.severity)}</span>`,
            ),
            ...(m.preferences || []).map((x) => `<span class="chip readonly">${esc(x)}</span>`),
          ].join("");
          return `
      <div class="party-item${sev ? " has-severe" : ""}">
        <div class="pi-head">
          <span class="nm">${esc(m.name)}</span>
          <span class="role-badge">${esc(m.role)}</span>
          ${m.travels ? "" : '<span class="role-badge muted">not travelling</span>'}
          ${m.booksOnBehalf ? '<span class="role-badge books">books</span>' : ""}
        </div>
        ${bits ? `<div class="chips">${bits}</div>` : '<div class="hint">No constraints recorded.</div>'}
        <div class="row tight" style="margin-top:6px;">
          <button class="ghost xs" data-party-edit="${esc(m.id)}">Edit</button>
          <button class="ghost xs" data-party-del="${esc(m.id)}">Remove</button>
        </div>
      </div>`;
        })
        .join("")
    : '<div class="hint">Just the artist so far. Add the tour manager, travel manager, or family here.</div>';

  $("partyList")
    .querySelectorAll("[data-party-edit]")
    .forEach((b) => (b.onclick = () => editPartyMember(b.dataset.partyEdit)));
  $("partyList")
    .querySelectorAll("[data-party-del]")
    .forEach((b) => (b.onclick = () => removePartyMember(b.dataset.partyDel)));

  // Role dropdown
  const roleSel = $("pmRole");
  if (!roleSel.options.length) {
    roleSel.innerHTML = META.partyRoles
      .filter((r) => r !== "artist")
      .map((r) => `<option value="${esc(r)}">${esc(r)}</option>`)
      .join("");
  }

  if (!editingPartyId) {
    pmDietEd = pmDietEd || chipEditor("pmDietEditor", { placeholder: "vegan…", cls: "diet" });
    pmAllergyEd =
      pmAllergyEd ||
      chipEditor("pmAllergyEditor", {
        placeholder: "shellfish:severe…",
        cls: "allergy",
        parse: parseAllergy,
        render: renderAllergy,
      });
    pmPrefEd = pmPrefEd || chipEditor("pmPrefEditor", { placeholder: "aisle seat…" });
  }
}

function renderBrands(p) {
  const b = p.brands || {};
  const mk = (mount, items, placeholder, cls = "") =>
    chipEditor(mount, { items: items || [], placeholder, cls });
  brandEds = {
    hotelChains: mk("hotelChainEditor", b.hotelChains, "Hilton, Soho House…"),
    airlines: mk("airlineEditor", b.airlines, "Lufthansa, United…"),
    railOperators: mk("railEditor", b.railOperators, "Eurostar, DB…"),
    carHire: mk("carHireEditor", b.carHire, "Sixt, Blacklane…"),
    avoid: mk("avoidEditor", b.avoid, "chains to never propose…", "avoid"),
  };
}

function renderLoyalty(p) {
  const list = p.loyalty || [];
  $("loyaltyList").innerHTML = list.length
    ? list
        .map(
          (l) => `
      <div class="loyalty-item">
        <div class="li-head">
          <span class="nm">${esc(l.program)}</span>
          <span class="cat-badge">${esc(l.category)}</span>
          ${l.tier ? `<span class="tier-badge">${esc(l.tier)}</span>` : ""}
        </div>
        <div class="li-meta">
          ${l.memberId ? `#${esc(l.memberId)}` : "<em>no membership number</em>"}
          ${
            l.points !== null && l.points !== undefined
              ? ` · ${Number(l.points).toLocaleString()} pts${
                  l.pointsUpdatedAt
                    ? ` <span class="as-of">as you entered it, ${new Date(
                        l.pointsUpdatedAt,
                      ).toLocaleDateString()}</span>`
                    : ""
                }`
              : ""
          }
        </div>
        <div class="row tight" style="margin-top:6px;">
          <button class="ghost xs" data-loy-edit="${esc(l.id)}">Edit</button>
          <button class="ghost xs" data-loy-del="${esc(l.id)}">Remove</button>
        </div>
      </div>`,
        )
        .join("")
    : '<div class="hint">No programmes yet. Add Hilton Honors, an airline scheme, or a venue VIP programme.</div>';

  $("loyaltyList")
    .querySelectorAll("[data-loy-edit]")
    .forEach((b) => (b.onclick = () => editLoyalty(b.dataset.loyEdit)));
  $("loyaltyList")
    .querySelectorAll("[data-loy-del]")
    .forEach((b) => (b.onclick = () => removeLoyalty(b.dataset.loyDel)));

  const catSel = $("lyCategory");
  if (!catSel.options.length) {
    catSel.innerHTML = META.loyaltyCategories
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join("");
  }
}

function renderAgency(p) {
  const a = p.agency || {};
  $("agEnabled").checked = a.enabled !== false;
  $("agName").value = a.name || "";
  $("agFee").value = a.feePerBooking ?? 50;
  $("agCurrency").value = a.currency || "USD";
  $("agContact").value = a.contact || "";
}

function renderEnrichment(p) {
  const e = p.enrichment || {};
  $("enrichSummary").innerHTML = e.lastRunAt
    ? `<div class="hint">Last researched ${new Date(e.lastRunAt).toLocaleString()}.</div>${
        e.lastSummary ? `<p class="notes">${esc(e.lastSummary)}</p>` : ""
      }`
    : "";

  const pending = (e.suggestions || []).filter((s) => s.status === "pending");
  const resolved = (e.suggestions || []).filter((s) => s.status !== "pending");

  const confBadge = { high: "well sourced", medium: "second-hand", low: "inferred" };
  $("enrichList").innerHTML =
    (pending.length
      ? pending
          .map(
            (s) => `
      <div class="suggestion conf-${esc(s.confidence)}">
        <div class="sg-head">
          <span class="sg-field">${esc(s.scope === "tool" ? s.toolId : s.field.replace("brands.", ""))}</span>
          <span class="conf-badge conf-${esc(s.confidence)}">${esc(
            confBadge[s.confidence] || s.confidence,
          )}</span>
        </div>
        <div class="sg-value">${esc(s.value)}</div>
        ${s.quote ? `<div class="sg-quote">“${esc(s.quote)}”</div>` : ""}
        <a class="ci-link" href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(
          s.source || "source",
        )} ↗</a>
        <div class="row tight" style="margin-top:7px;">
          <button class="ghost xs" data-sg-accept="${esc(s.id)}">Accept</button>
          <button class="ghost xs" data-sg-dismiss="${esc(s.id)}">Dismiss</button>
        </div>
      </div>`,
          )
          .join("")
      : e.lastRunAt
        ? '<div class="hint">Nothing pending — every suggestion has been accepted or dismissed.</div>'
        : "") +
    (resolved.length
      ? `<details class="section"><summary>Reviewed (${resolved.length})</summary><div class="inner">${resolved
          .map(
            (s) =>
              `<div class="memory-item"><span class="status-badge ${
                s.status === "accepted" ? "chosen" : "rejected"
              }">${esc(s.status)}</span> ${esc(s.value)}</div>`,
          )
          .join("")}</div></details>`
      : "");

  $("enrichList")
    .querySelectorAll("[data-sg-accept]")
    .forEach((b) => (b.onclick = () => resolveSuggestion(b.dataset.sgAccept, true)));
  $("enrichList")
    .querySelectorAll("[data-sg-dismiss]")
    .forEach((b) => (b.onclick = () => resolveSuggestion(b.dataset.sgDismiss, false)));
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
  [
    "tourCard",
    "toolPrefCard",
    "memoryCard",
    "globalCard",
    "partyCard",
    "loyaltyCard",
    "agencyCard",
    "researchCard",
  ].forEach((id) => $(id).classList.toggle("hidden", !hasProfile));
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

  renderParty(p);
  renderBrands(p);
  renderLoyalty(p);
  renderAgency(p);
  renderEnrichment(p);

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
  briefSelection.clear(); // selections belong to one tour's plan, not the next
  $("itineraryCard").classList.add("hidden");
  $("globalLearned").classList.add("hidden");

  if (activeProfileId && activeTourId && activeToolId) {
    const r = await fetch(
      `/api/profiles/${activeProfileId}/tours/${activeTourId}/threads/${activeToolId}`,
    );
    if (r.ok) activeThread = await r.json();

    // On the master planner, show the tour's saved plan straight away.
    if (activeToolId === "itinerary") {
      const s = await fetch(`/api/profiles/${activeProfileId}/tours/${activeTourId}/itinerary`);
      if (s.ok) {
        const summary = await s.json();
        if (summary.itinerary) renderItinerary(summary.itinerary);
      }
    }
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

/* ================================================ party / loyalty / agency */

function partyForm() {
  return {
    name: $("pmName").value.trim(),
    role: $("pmRole").value,
    email: $("pmEmail").value.trim(),
    travels: $("pmTravels").checked,
    booksOnBehalf: $("pmBooks").checked,
    dietary: pmDietEd.get(),
    allergies: pmAllergyEd.get(),
    preferences: pmPrefEd.get(),
  };
}

function clearPartyForm() {
  editingPartyId = null;
  $("pmName").value = "";
  $("pmEmail").value = "";
  $("pmTravels").checked = true;
  $("pmBooks").checked = false;
  pmDietEd.set([]);
  pmAllergyEd.set([]);
  pmPrefEd.set([]);
  $("savePartyMember").textContent = "Save person";
  $("cancelPartyEdit").classList.add("hidden");
}

function editPartyMember(id) {
  const m = (profile()?.party || []).find((x) => x.id === id);
  if (!m) return;
  editingPartyId = id;
  $("partyAddSection").open = true;
  $("pmName").value = m.name;
  $("pmRole").value = m.role;
  $("pmEmail").value = m.email || "";
  $("pmTravels").checked = m.travels !== false;
  $("pmBooks").checked = !!m.booksOnBehalf;
  pmDietEd.set(m.dietary || []);
  pmAllergyEd.set(m.allergies || []);
  pmPrefEd.set(m.preferences || []);
  $("savePartyMember").textContent = "Update person";
  $("cancelPartyEdit").classList.remove("hidden");
}

$("savePartyMember").onclick = async () => {
  if (!activeProfileId) return;
  const body = partyForm();
  if (!body.name) return $("pmName").focus();
  if (editingPartyId) body.id = editingPartyId;

  await fetch(`/api/profiles/${activeProfileId}/party`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  flash("partyMsg", editingPartyId ? "Updated." : "Added.");
  clearPartyForm();
  await loadProfiles();
};

$("cancelPartyEdit").onclick = () => {
  clearPartyForm();
  renderSidebar();
};

async function removePartyMember(id) {
  const m = (profile()?.party || []).find((x) => x.id === id);
  if (!m || !confirm(`Remove ${m.name} from the party?`)) return;
  await fetch(`/api/profiles/${activeProfileId}/party/${id}`, { method: "DELETE" });
  if (editingPartyId === id) clearPartyForm();
  await loadProfiles();
}

$("saveBrands").onclick = async () => {
  if (!activeProfileId) return;
  const brands = {};
  for (const [k, ed] of Object.entries(brandEds)) brands[k] = ed.get();
  await fetch(`/api/profiles/${activeProfileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brands }),
  });
  flash("brandMsg", "Saved.");
  await loadProfiles();
};

function clearLoyaltyForm() {
  editingLoyaltyId = null;
  ["lyProgram", "lyTier", "lyMemberId", "lyPoints"].forEach((id) => ($(id).value = ""));
  $("saveLoyalty").textContent = "Save programme";
  $("cancelLoyaltyEdit").classList.add("hidden");
}

function editLoyalty(id) {
  const l = (profile()?.loyalty || []).find((x) => x.id === id);
  if (!l) return;
  editingLoyaltyId = id;
  $("lyProgram").value = l.program;
  $("lyCategory").value = l.category;
  $("lyTier").value = l.tier || "";
  $("lyMemberId").value = l.memberId || "";
  $("lyPoints").value = l.points ?? "";
  $("saveLoyalty").textContent = "Update programme";
  $("cancelLoyaltyEdit").classList.remove("hidden");
}

$("saveLoyalty").onclick = async () => {
  if (!activeProfileId) return;
  const program = $("lyProgram").value.trim();
  if (!program) return $("lyProgram").focus();
  const pts = $("lyPoints").value.trim();

  await fetch(`/api/profiles/${activeProfileId}/loyalty`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: editingLoyaltyId || undefined,
      program,
      category: $("lyCategory").value,
      tier: $("lyTier").value.trim(),
      memberId: $("lyMemberId").value.trim(),
      points: pts === "" ? null : Number(pts),
    }),
  });
  flash("loyaltyMsg", editingLoyaltyId ? "Updated." : "Added.");
  clearLoyaltyForm();
  await loadProfiles();
};

$("cancelLoyaltyEdit").onclick = () => {
  clearLoyaltyForm();
  renderSidebar();
};

async function removeLoyalty(id) {
  const l = (profile()?.loyalty || []).find((x) => x.id === id);
  if (!l || !confirm(`Remove ${l.program}?`)) return;
  await fetch(`/api/profiles/${activeProfileId}/loyalty/${id}`, { method: "DELETE" });
  if (editingLoyaltyId === id) clearLoyaltyForm();
  await loadProfiles();
}

$("saveAgency").onclick = async () => {
  if (!activeProfileId) return;
  await fetch(`/api/profiles/${activeProfileId}/agency`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: $("agEnabled").checked,
      name: $("agName").value.trim(),
      feePerBooking: Number($("agFee").value),
      currency: $("agCurrency").value.trim(),
      contact: $("agContact").value.trim(),
    }),
  });
  flash("agencyMsg", "Saved.");
  await loadProfiles();
};

/* ============================================================== research */

$("runEnrich").onclick = async () => {
  if (!activeProfileId) return;
  $("runEnrich").disabled = true;
  $("enrichMsg").innerHTML = '<span class="spinner-line"><span class="pulse"></span>Searching…</span>';
  try {
    const r = await fetch(`/api/profiles/${activeProfileId}/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hint: $("enrichHint").value.trim() }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Research failed");
    $("enrichMsg").textContent = data.found
      ? `${data.found} suggestion${data.found === 1 ? "" : "s"} to review.`
      : "Nothing new found in public sources.";
    await loadProfiles();
  } catch (e) {
    $("enrichMsg").innerHTML = `<span class="error">${esc(e.message)}</span>`;
  } finally {
    $("runEnrich").disabled = false;
  }
};

async function resolveSuggestion(id, accept) {
  await fetch(`/api/profiles/${activeProfileId}/enrich/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept }),
  });
  await loadProfiles();
}

/** Mark (or unmark) an itinerary segment as actually booked by the user. */
async function confirmSegment(key, reference, confirmed, channel = "direct") {
  const r = await fetch(`/api/profiles/${activeProfileId}/tours/${activeTourId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentKey: key, reference, confirmed, channel }),
  });
  if (!r.ok) return;
  briefSelection.delete(key); // it's booked; it no longer needs sending
  const summary = await r.json();
  if (summary.itinerary) renderItinerary(summary.itinerary);
}

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
    if (data.itinerary) renderItinerary(data.itinerary);
    renderOptions(data);
    renderGlobalLearned(data.globalLearned || []);
    $("status").textContent = "";
    await loadProfiles();
  } catch (e) {
    $("status").innerHTML = `<span class="error">${esc(e.message)}</span>`;
    renderThread();
  } finally {
    $("send").disabled = false;
  }
}

/**
 * Surface anything that was written to the PERSON (not just this service area),
 * so a dietary note dropped in the transport chat visibly lands everywhere.
 */
function renderGlobalLearned(items) {
  const el = $("globalLearned");
  if (!items.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  const icon = {
    dietary: "🥗",
    allergy: "⚠️",
    preference: "★",
    note: "✎",
    brand: "🏷",
    avoid: "🚫",
    party: "👥",
  };
  el.classList.remove("hidden");
  el.innerHTML =
    `<strong>Saved to ${esc(profile()?.name || "this person")} — applies in every chat:</strong> ` +
    items.map((i) => `<span class="gl-chip">${icon[i.kind] || "•"} ${esc(i.text)}</span>`).join(" ");
}

/**
 * Rewards line. `matchedHeld` is set server-side and is the only reason a
 * programme name appears at all — anything the model invented was stripped
 * before it got here.
 */
function renderLoyaltyLine(l) {
  if (!l?.matchedHeld || !l.program) return "";
  const earns = {
    yes: '<span class="earn yes">earns here</span>',
    no: '<span class="earn no">does not earn here</span>',
    unknown: '<span class="earn unknown">earning unconfirmed</span>',
  }[l.earns] || "";
  return `
    <div class="loyalty-line">
      <span class="star">★</span>
      <strong>${esc(l.program)}</strong>${l.tier ? ` · ${esc(l.tier)}` : ""} ${earns}
      ${l.tierBenefit ? `<div class="loyalty-perk">${esc(l.tierBenefit)}</div>` : ""}
      ${l.note ? `<div class="loyalty-note">${esc(l.note)}</div>` : ""}
    </div>`;
}

/** The two ways to book: the free direct link, and the agency at its flat fee. */
function renderBookingLine(b) {
  if (!b) return "";
  const direct = b.direct?.available
    ? `<a class="book-direct" href="${esc(b.direct.url)}" target="_blank" rel="noopener">Book direct ↗ — free</a>`
    : '<span class="book-none">No direct link found</span>';
  const agency = b.agency?.available
    ? `<span class="book-agency${b.agency.recommended ? " rec" : ""}">
         Via ${esc(b.agency.name)} — ${esc(b.agency.currency)} ${b.agency.fee}
         ${b.agency.recommended ? `<span class="rec-tag">recommended</span>` : ""}
       </span>`
    : "";
  return `
    <div class="booking-line">${direct}${agency}</div>
    ${b.agency?.reason ? `<div class="agency-reason">${esc(b.agency.reason)}</div>` : ""}`;
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
    // Name whose allergy it is — the party eats together, so "tree nuts (Dana)"
    // is what the kitchen actually needs to hear.
    const named = w.active
      .map((a) => `${esc(a.name)}${a.owners?.length ? ` (${a.owners.map(esc).join(", ")})` : ""}`)
      .join(", ");
    bannerHtml += `<div class="banner">⚠️ Allergy check active across the party for
      <strong>${named}</strong>.${severe}
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
        ${
          (o.serves || []).length
            ? `<div class="serves">👥 Works for ${o.serves.map(esc).join(", ")}</div>`
            : ""
        }
        ${renderLoyaltyLine(o.loyalty)}
        ${o.notes ? `<p class="notes">${esc(o.notes)}</p>` : ""}
        ${renderBookingLine(o.booking)}
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
  [TOOLS, META] = await Promise.all([
    (await fetch("/api/tools")).json(),
    (await fetch("/api/meta")).json(),
  ]);
  if (!TOOLS.find((t) => t.id === activeToolId)) activeToolId = TOOLS[0]?.id;
  await loadProfiles();
})();
