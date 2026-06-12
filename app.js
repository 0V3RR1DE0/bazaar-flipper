"use strict";

/* ============================================================
 * Skyblock Bazaar Flip Finder
 * Live data from the public Hypixel API.
 * Three flip modes:
 *   - bazaar: order-flip the spread (buy order -> sell offer) + tax
 *   - npc:    buy on bazaar (buy order) -> sell to NPC (no tax)
 *   - craft:  buy ingredients on bazaar -> craft -> best exit (bazaar/NPC)
 * Plus: risk flags, order-book depth, budget projection, watchlist,
 *       click-to-copy, profit alerts, CSV export, tax tiers, sparklines, PWA.
 * ============================================================ */

const BAZAAR_URL = "https://api.hypixel.net/v2/skyblock/bazaar";
const ITEMS_URL = "https://api.hypixel.net/v2/resources/skyblock/items";
const HOURS_PER_WEEK = 168;
const REFRESH_SECONDS = 30;
const HISTORY_LEN = 30;

const TAX_TIERS = { none: 1.25, t1: 1.125, t2: 1.0 };

const DEFAULTS = {
  mode: "bazaar",
  search: "",
  minVolume: 50000,
  taxPct: 1.25,
  taxPerk: "none",
  sharePct: 10,
  budget: 0,
  topN: 100,
  alertThreshold: 0,
  autoRefresh: true,
  onlyWatch: false,
  pinWatch: true,
  sortKey: "profitPerHour",
  sortDir: "desc",
};

const state = {
  settings: loadSettings(),
  products: null,
  names: {},
  npc: {}, // id -> npc_sell_price
  lastUpdated: null,
  countdown: REFRESH_SECONDS,
  watch: loadWatch(),
  history: new Map(), // "mode:id" -> [marginPerUnit, ...]
  alerted: new Set(),
  lastShown: [],
};

const el = {
  status: document.getElementById("status-line"),
  error: document.getElementById("error-banner"),
  refresh: document.getElementById("refresh-btn"),
  reset: document.getElementById("reset-btn"),
  csv: document.getElementById("csv-btn"),
  body: document.getElementById("flip-body"),
  count: document.getElementById("result-count"),
  toast: document.getElementById("toast"),
  mode: document.getElementById("mode"),
  search: document.getElementById("search"),
  minVolume: document.getElementById("min-volume"),
  tax: document.getElementById("tax"),
  taxPerk: document.getElementById("tax-perk"),
  share: document.getElementById("share"),
  budget: document.getElementById("budget"),
  topN: document.getElementById("top-n"),
  alertThreshold: document.getElementById("alert-threshold"),
  autoRefresh: document.getElementById("auto-refresh"),
  onlyWatch: document.getElementById("only-watch"),
  headers: document.querySelectorAll("th[data-sort]"),
};

/* ---------------- Persistence ---------------- */
function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("bazaarFlipSettings") || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  localStorage.setItem("bazaarFlipSettings", JSON.stringify(state.settings));
}
function loadWatch() {
  try {
    return new Set(JSON.parse(localStorage.getItem("bazaarFlipWatch") || "[]"));
  } catch {
    return new Set();
  }
}
function saveWatch() {
  localStorage.setItem("bazaarFlipWatch", JSON.stringify([...state.watch]));
}

/* ---------------- Data fetching ---------------- */
async function fetchBazaar() {
  const res = await fetch(BAZAAR_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Bazaar API returned HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error("Bazaar API reported success=false");
  state.products = data.products;
  state.lastUpdated = data.lastUpdated;
}

// Names + NPC sell prices are static-ish; fetch once and reuse.
async function fetchItemMeta() {
  if (Object.keys(state.names).length) return;
  try {
    const res = await fetch(ITEMS_URL, { cache: "force-cache" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && Array.isArray(data.items)) {
      for (const item of data.items) {
        if (!item.id) continue;
        if (item.name) state.names[item.id] = item.name;
        if (typeof item.npc_sell_price === "number") state.npc[item.id] = item.npc_sell_price;
      }
    }
  } catch {
    /* meta is non-critical; fall back to prettified IDs */
  }
}

/* ---------------- Price / book helpers ---------------- */
const prod = (id) => state.products[id];
const buyOrderFill = (q) => q.sellPrice; // our buy order fills at the top buy order
const sellOfferFill = (q) => q.buyPrice; // our sell offer fills at the lowest sell offer

function sumAmounts(summary) {
  let t = 0;
  for (const e of summary) t += e.amount;
  return t;
}
function depthNearBest(summary, side) {
  if (!summary || !summary.length) return 0;
  const best = summary[0].pricePerUnit;
  let units = 0;
  for (const e of summary) {
    if (side === "buy") {
      if (e.pricePerUnit >= best * 0.99) units += e.amount;
      else break;
    } else {
      if (e.pricePerUnit <= best * 1.01) units += e.amount;
      else break;
    }
  }
  return units;
}
function computeRisk(p, q, marginPct) {
  const reasons = [];
  let score = 0;
  const buyTotal = sumAmounts(p.buy_summary);
  const sellTotal = sumAmounts(p.sell_summary);
  const topBuyShare = buyTotal ? p.buy_summary[0].amount / buyTotal : 1;
  const topSellShare = sellTotal ? p.sell_summary[0].amount / sellTotal : 1;
  if (topBuyShare > 0.6 || topSellShare > 0.6) {
    score += 2;
    reasons.push("One order dominates the book (possible whale/manipulation)");
  } else if (topBuyShare > 0.4 || topSellShare > 0.4) {
    score += 1;
    reasons.push("Order book is concentrated in few orders");
  }
  if (q.buyOrders < 5 || q.sellOrders < 5) {
    score += 2;
    reasons.push("Very few orders — price is easily moved");
  } else if (q.buyOrders < 15 || q.sellOrders < 15) {
    score += 1;
    reasons.push("Shallow order book");
  }
  if (marginPct > 100) {
    score += 3;
    reasons.push("Extreme spread — almost certainly a thin/manipulated price");
  } else if (marginPct > 30) {
    score += 2;
    reasons.push("Unusually high spread — verify before committing");
  } else if (marginPct > 15) {
    score += 1;
    reasons.push("High spread");
  }
  const level = score >= 3 ? 2 : score >= 1 ? 1 : 0;
  return { level, reasons, score };
}
const nameOf = (id) => state.names[id] || prettifyId(id);
function prettifyId(id) {
  return id
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/* ---------------- Mode: BAZAAR ---------------- */
function computeBazaarFlips(opts) {
  const tax = opts.taxPct / 100;
  const share = opts.sharePct / 100;
  const flips = [];
  for (const id in state.products) {
    const p = state.products[id];
    const q = p.quick_status;
    if (!q || !p.buy_summary?.length || !p.sell_summary?.length) continue;
    const cost = buyOrderFill(q);
    const exit = sellOfferFill(q);
    if (!(cost > 0) || !(exit > 0)) continue;
    const marginPerUnit = exit * (1 - tax) - cost;
    if (marginPerUnit <= 0) continue;

    const buyMovingWeek = q.buyMovingWeek || 0;
    const sellMovingWeek = q.sellMovingWeek || 0;
    const limitingWeekly = Math.min(buyMovingWeek, sellMovingWeek);
    if (limitingWeekly < opts.minVolume) continue;

    const depth = Math.min(depthNearBest(p.buy_summary, "buy"), depthNearBest(p.sell_summary, "sell"));
    const marginPct = (marginPerUnit / cost) * 100;
    const risk = computeRisk(p, q, marginPct);
    flips.push(
      buildFlip({
        mode: "bazaar", id, name: nameOf(id), sub: id,
        cost, exit, marginPerUnit, marginPct, depth,
        limitingWeekly, buyMovingWeek, sellMovingWeek, share, opts, risk,
        exitLabel: "Bazaar",
      })
    );
  }
  return flips;
}

/* ---------------- Mode: NPC ---------------- */
function computeNpcFlips(opts) {
  const share = opts.sharePct / 100;
  const flips = [];
  for (const id in state.products) {
    const npcPrice = state.npc[id];
    if (!(npcPrice > 0)) continue;
    const p = state.products[id];
    const q = p.quick_status;
    if (!q || !p.sell_summary?.length) continue;
    const cost = buyOrderFill(q); // acquire via buy order
    if (!(cost > 0)) continue;
    const marginPerUnit = npcPrice - cost; // NPC sales are untaxed
    if (marginPerUnit <= 0) continue;

    const buyMovingWeek = q.buyMovingWeek || 0;
    // Throughput is limited by how fast we can ACQUIRE (NPC selling is unlimited).
    const limitingWeekly = buyMovingWeek;
    if (limitingWeekly < opts.minVolume) continue;

    const depth = depthNearBest(p.sell_summary, "sell"); // offers available to fill our buys
    const marginPct = (marginPerUnit / cost) * 100;
    const risk = computeRisk(p, q, marginPct);
    flips.push(
      buildFlip({
        mode: "npc", id, name: nameOf(id), sub: `Bazaar → NPC @ ${formatCoins(npcPrice)}`,
        cost, exit: npcPrice, marginPerUnit, marginPct, depth,
        limitingWeekly, buyMovingWeek, sellMovingWeek: Infinity, share, opts, risk,
        exitLabel: "NPC",
      })
    );
  }
  return flips;
}

/* ---------------- Mode: CRAFT ---------------- */
function computeCraftFlips(opts) {
  const tax = opts.taxPct / 100;
  const share = opts.sharePct / 100;
  const recipes = window.BAZAAR_RECIPES || [];
  const flips = [];

  for (const recipe of recipes) {
    const out = prod(recipe.output);
    if (!out || !out.quick_status || !out.buy_summary?.length) continue;

    // Sum ingredient acquisition cost (buy orders) and the limiting inputs.
    let ingredientCost = 0;
    let acquisitionWeekly = Infinity;
    let inputDepth = Infinity;
    let ok = true;
    for (const inp of recipe.inputs) {
      const ip = prod(inp.id);
      if (!ip || !ip.quick_status || !ip.sell_summary?.length) { ok = false; break; }
      const unitCost = buyOrderFill(ip.quick_status);
      if (!(unitCost > 0)) { ok = false; break; }
      ingredientCost += unitCost * inp.qty;
      acquisitionWeekly = Math.min(acquisitionWeekly, (ip.quick_status.buyMovingWeek || 0) / inp.qty);
      inputDepth = Math.min(inputDepth, depthNearBest(ip.sell_summary, "sell") / inp.qty);
    }
    if (!ok || ingredientCost <= 0) continue;

    // Best exit: sell crafted on bazaar (taxed) vs. sell to NPC (untaxed).
    const oq = out.quick_status;
    const bazaarNet = sellOfferFill(oq) * (1 - tax);
    const npcNet = state.npc[recipe.output] || 0;
    const useNpc = npcNet > bazaarNet;
    const exitGross = useNpc ? npcNet : sellOfferFill(oq);
    const exitNet = useNpc ? npcNet : bazaarNet;

    const marginPerUnit = exitNet - ingredientCost;
    if (marginPerUnit <= 0) continue;

    const sellWeekly = useNpc ? Infinity : oq.sellMovingWeek || 0;
    const limitingWeekly = Math.min(acquisitionWeekly, sellWeekly);
    if (limitingWeekly < opts.minVolume) continue;

    const depth = Math.min(inputDepth, useNpc ? Infinity : depthNearBest(out.buy_summary, "buy"));
    const marginPct = (marginPerUnit / ingredientCost) * 100;
    const risk = computeRisk(out, oq, marginPct);
    const recipeText = recipe.inputs.map((i) => `${formatInt(i.qty)}× ${nameOf(i.id)}`).join(" + ");

    flips.push(
      buildFlip({
        mode: "craft", id: recipe.output, name: nameOf(recipe.output),
        sub: `Craft: ${recipeText}`,
        cost: ingredientCost, exit: exitGross, marginPerUnit, marginPct, depth,
        limitingWeekly, buyMovingWeek: acquisitionWeekly, sellMovingWeek: sellWeekly,
        share, opts, risk, exitLabel: useNpc ? "NPC" : "Bazaar",
      })
    );
  }
  return flips;
}

// Shared assembly of a flip row (throughput, budget projection).
function buildFlip(a) {
  const flipsPerHour = (a.limitingWeekly / HOURS_PER_WEEK) * a.share;
  const profitPerHour = a.marginPerUnit * flipsPerHour;
  const unitsAffordable = a.opts.budget > 0 ? Math.floor(a.opts.budget / a.cost) : Infinity;
  const effUnits = Math.min(unitsAffordable, a.depth);
  const budgetProfit = a.opts.budget > 0 ? a.marginPerUnit * effUnits : 0;
  return {
    mode: a.mode, id: a.id, name: a.name, sub: a.sub,
    buyOrderPrice: a.cost, sellOfferPrice: a.exit,
    marginPerUnit: a.marginPerUnit, marginPct: a.marginPct,
    depth: a.depth, limitingWeekly: a.limitingWeekly,
    buyMovingWeek: a.buyMovingWeek, sellMovingWeek: a.sellMovingWeek,
    profitPerHour, budgetProfit, effUnits, unitsAffordable,
    riskLevel: a.risk.level, riskScore: a.risk.score, riskReasons: a.risk.reasons,
    exitLabel: a.exitLabel,
  };
}

function computeForMode(mode, opts) {
  if (mode === "npc") return computeNpcFlips(opts);
  if (mode === "craft") return computeCraftFlips(opts);
  return computeBazaarFlips(opts);
}

/* ---------------- Formatting ---------------- */
function formatCoins(n) {
  if (!isFinite(n)) return "∞";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return n.toFixed(abs < 10 ? 1 : 0);
}
function formatInt(n) {
  if (!isFinite(n)) return "∞";
  return Math.round(n).toLocaleString("en-US");
}
function timeAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}

const RISK_BADGE = {
  0: { txt: "Safe", cls: "risk-safe" },
  1: { txt: "Caution", cls: "risk-caution" },
  2: { txt: "Risky", cls: "risk-risky" },
};

function sparkline(values) {
  if (!values || values.length < 2) return '<span class="spark-empty">—</span>';
  const w = 56, h = 16;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return `<svg width="${w}" height="${h}" class="spark"><polyline points="${pts}" fill="none" stroke="${
    up ? "#55ff55" : "#ff5555"
  }" stroke-width="1.5" /></svg>`;
}

/* ---------------- Mode-aware column labels ---------------- */
const MODE_COL = {
  bazaar: { buyOrderPrice: "Buy order", sellOfferPrice: "Sell offer" },
  npc: { buyOrderPrice: "Bazaar cost", sellOfferPrice: "NPC price" },
  craft: { buyOrderPrice: "Craft cost", sellOfferPrice: "Exit price" },
};
const STATIC_COL = {
  marginPerUnit: "Margin/unit",
  marginPct: "Margin %",
  depth: "Depth",
  limitingWeekly: "Wk vol",
  profitPerHour: "Profit/hr",
  budgetProfit: "Profit (budget)",
  riskScore: "Risk",
};
function columnLabel(key) {
  return (MODE_COL[state.settings.mode] && MODE_COL[state.settings.mode][key]) || STATIC_COL[key] || "";
}

/* ---------------- Rendering ---------------- */
function getFilteredSorted() {
  const s = state.settings;
  let flips = computeForMode(s.mode, {
    taxPct: s.taxPct, sharePct: s.sharePct, minVolume: s.minVolume, budget: s.budget,
  });
  const query = s.search.trim().toLowerCase();
  if (query) {
    flips = flips.filter((f) => f.name.toLowerCase().includes(query) || f.id.toLowerCase().includes(query));
  }
  if (s.onlyWatch) flips = flips.filter((f) => state.watch.has(f.id));

  const dir = s.sortDir === "asc" ? 1 : -1;
  flips.sort((a, b) => {
    const av = a[s.sortKey], bv = b[s.sortKey];
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  if (s.pinWatch && state.watch.size) {
    flips.sort((a, b) => (state.watch.has(b.id) ? 1 : 0) - (state.watch.has(a.id) ? 1 : 0));
  }
  return flips;
}

function applyFiltersAndRender() {
  if (!state.products) return;
  const all = getFilteredSorted();
  const shown = all.slice(0, state.settings.topN);
  renderRows(shown);
  const s = state.settings;
  const modeName = { bazaar: "bazaar", npc: "NPC", craft: "craft" }[s.mode];
  el.count.textContent = all.length
    ? `Showing ${shown.length} of ${all.length} ${modeName} flips · ${s.taxPct}% tax · min ${formatInt(
        s.minVolume
      )} wk vol · ${s.sharePct}% share` + (s.budget > 0 ? ` · budget ${formatCoins(s.budget)}` : "")
    : `No ${modeName} flips match the current filters.`;
  updateSortHeaders();
  state.lastShown = shown;
}

function renderRows(flips) {
  if (!flips.length) {
    el.body.innerHTML = `<tr><td colspan="12" class="empty">No flips match the current filters.</td></tr>`;
    return;
  }
  const budgetOn = state.settings.budget > 0;
  el.body.innerHTML = flips
    .map((f) => {
      const cls = f.marginPerUnit >= 0 ? "pos" : "neg";
      const badge = RISK_BADGE[f.riskLevel];
      const watched = state.watch.has(f.id);
      const reasons = f.riskReasons.length ? escapeHtml(f.riskReasons.join(" • ")) : "No risk flags";
      const exitTag = f.exitLabel === "NPC" ? ` <span class="exit-npc">NPC</span>` : "";
      const budgetCell = budgetOn
        ? `<td class="profit ${f.budgetProfit > 0 ? "pos" : ""}" title="${formatInt(
            f.effUnits
          )} units (affordable: ${formatInt(f.unitsAffordable)})">${formatCoins(f.budgetProfit)}</td>`
        : `<td class="muted">—</td>`;
      return `<tr>
        <td class="left star-cell"><button class="star ${watched ? "on" : ""}" data-watch="${escapeHtml(
        f.id
      )}" title="Toggle watchlist">${watched ? "★" : "☆"}</button></td>
        <td class="left">
          <button class="item-name copy-name" data-copy="${escapeHtml(f.name)}" title="Click to copy">${escapeHtml(
        f.name
      )}</button><br /><span class="item-sub">${escapeHtml(f.sub)}</span>
        </td>
        <td>${formatCoins(f.buyOrderPrice)}</td>
        <td>${formatCoins(f.sellOfferPrice)}${exitTag}</td>
        <td class="${cls}">${formatCoins(f.marginPerUnit)}</td>
        <td class="${cls}">${f.marginPct.toFixed(1)}%</td>
        <td title="Units available within ~1% of the spread">${formatInt(f.depth)}</td>
        <td title="Buy ${formatInt(f.buyMovingWeek)} / Sell ${formatInt(f.sellMovingWeek)} per week">${formatInt(
        f.limitingWeekly
      )}</td>
        <td class="profit pos">${formatCoins(f.profitPerHour)}</td>
        ${budgetCell}
        <td><span class="risk ${badge.cls}" title="${reasons}">${badge.txt}</span></td>
        <td class="spark-cell">${sparkline(state.history.get(f.mode + ":" + f.id))}</td>
      </tr>`;
    })
    .join("");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function updateSortHeaders() {
  el.headers.forEach((th) => {
    const key = th.dataset.sort;
    const label = columnLabel(key);
    if (!label) return;
    const isActive = key === state.settings.sortKey;
    th.classList.toggle("active", isActive);
    const arrow = isActive ? (state.settings.sortDir === "asc" ? " ▲" : " ▼") : "";
    th.textContent = label + arrow;
  });
}

/* ---------------- History + alerts ---------------- */
function recordHistory(flips) {
  for (const f of flips) {
    const key = f.mode + ":" + f.id;
    const arr = state.history.get(key) || [];
    arr.push(f.marginPerUnit);
    if (arr.length > HISTORY_LEN) arr.shift();
    state.history.set(key, arr);
  }
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = "square";
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 140);
  } catch {}
}
function checkAlerts(flips) {
  const threshold = state.settings.alertThreshold;
  if (!threshold || threshold <= 0) return;
  const newly = [];
  const stillAbove = new Set();
  for (const f of flips) {
    if (f.profitPerHour >= threshold) {
      stillAbove.add(f.id);
      if (!state.alerted.has(f.id)) newly.push(f);
    }
  }
  state.alerted = stillAbove;
  if (!newly.length) return;
  beep();
  const top = newly.sort((a, b) => b.profitPerHour - a.profitPerHour).slice(0, 3);
  const lines = top.map((f) => `${f.name}: ${formatCoins(f.profitPerHour)}/hr`).join("\n");
  showToast(`🔔 ${newly.length} flip(s) above ${formatCoins(threshold)}/hr`);
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Bazaar flip alert", { body: lines });
  }
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1800);
}

/* ---------------- CSV export ---------------- */
function exportCsv() {
  const flips = state.lastShown || [];
  if (!flips.length) return showToast("Nothing to export");
  const cols = [
    "mode", "id", "name", "buyOrderPrice", "sellOfferPrice", "marginPerUnit",
    "marginPct", "depth", "limitingWeekly", "profitPerHour", "budgetProfit", "riskLevel", "exitLabel",
  ];
  const rows = [cols.join(",")];
  for (const f of flips) {
    rows.push(
      cols
        .map((c) => {
          const v = f[c];
          if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
          return isFinite(v) ? Math.round(v * 100) / 100 : "";
        })
        .join(",")
    );
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bazaar-${state.settings.mode}-flips-${new Date().toISOString().slice(0, 16).replace(":", "")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Exported CSV");
}

/* ---------------- Status / refresh ---------------- */
function updateStatus() {
  if (!state.lastUpdated) return;
  const countdownTxt = state.settings.autoRefresh
    ? ` · next in <span class="countdown">${state.countdown}s</span>`
    : "";
  el.status.innerHTML = `<span class="ok">●</span> Updated ${timeAgo(state.lastUpdated)}${countdownTxt}`;
}
function showError(msg) {
  el.error.textContent = "⚠ " + msg + " — showing last known data if available.";
  el.error.classList.remove("hidden");
}
function clearError() {
  el.error.classList.add("hidden");
}

async function refresh() {
  el.refresh.classList.add("spinning");
  try {
    await Promise.all([fetchBazaar(), fetchItemMeta()]);
    clearError();
    const flips = getFilteredSorted();
    // History across all profitable flips in the current mode (ignore min-vol filter).
    recordHistory(
      computeForMode(state.settings.mode, {
        taxPct: state.settings.taxPct, sharePct: state.settings.sharePct, minVolume: 0, budget: state.settings.budget,
      })
    );
    checkAlerts(flips);
    applyFiltersAndRender();
  } catch (err) {
    showError(err.message || "Failed to load bazaar data");
  } finally {
    el.refresh.classList.remove("spinning");
    state.countdown = REFRESH_SECONDS;
    updateStatus();
  }
}

setInterval(() => {
  updateStatus();
  if (!state.settings.autoRefresh || document.hidden) return;
  state.countdown -= 1;
  if (state.countdown <= 0) refresh();
}, 1000);

/* ---------------- Controls ---------------- */
function syncInputsFromSettings() {
  const s = state.settings;
  el.mode.value = s.mode;
  el.search.value = s.search;
  el.minVolume.value = s.minVolume;
  el.tax.value = s.taxPct;
  el.taxPerk.value = s.taxPerk;
  el.share.value = s.sharePct;
  el.budget.value = s.budget;
  el.topN.value = s.topN;
  el.alertThreshold.value = s.alertThreshold;
  el.autoRefresh.checked = s.autoRefresh;
  el.onlyWatch.checked = s.onlyWatch;
}

function bindControls() {
  const num = (v) => (v === "" ? null : Number(v));
  const onChange = (key, parse) => (e) => {
    const v = parse(e.target.value);
    if (v === null || Number.isNaN(v)) return;
    state.settings[key] = v;
    saveSettings();
    applyFiltersAndRender();
  };

  el.mode.addEventListener("change", (e) => {
    state.settings.mode = e.target.value;
    state.alerted.clear();
    saveSettings();
    applyFiltersAndRender();
  });
  el.search.addEventListener("input", onChange("search", (v) => v));
  el.minVolume.addEventListener("input", onChange("minVolume", num));
  el.share.addEventListener("input", onChange("sharePct", num));
  el.budget.addEventListener("input", onChange("budget", num));
  el.topN.addEventListener("input", onChange("topN", num));

  el.tax.addEventListener("input", (e) => {
    const v = num(e.target.value);
    if (v === null || Number.isNaN(v)) return;
    state.settings.taxPct = v;
    state.settings.taxPerk = "custom";
    el.taxPerk.value = "custom";
    saveSettings();
    applyFiltersAndRender();
  });
  el.taxPerk.addEventListener("change", (e) => {
    const perk = e.target.value;
    state.settings.taxPerk = perk;
    if (TAX_TIERS[perk] !== undefined) {
      state.settings.taxPct = TAX_TIERS[perk];
      el.tax.value = state.settings.taxPct;
    }
    saveSettings();
    applyFiltersAndRender();
  });
  el.alertThreshold.addEventListener("input", (e) => {
    const v = num(e.target.value);
    if (v === null || Number.isNaN(v)) return;
    state.settings.alertThreshold = v;
    state.alerted.clear();
    saveSettings();
    if (v > 0 && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  });
  el.autoRefresh.addEventListener("change", (e) => {
    state.settings.autoRefresh = e.target.checked;
    state.countdown = REFRESH_SECONDS;
    saveSettings();
    updateStatus();
  });
  el.onlyWatch.addEventListener("change", (e) => {
    state.settings.onlyWatch = e.target.checked;
    saveSettings();
    applyFiltersAndRender();
  });

  el.refresh.addEventListener("click", refresh);
  el.csv.addEventListener("click", exportCsv);
  el.reset.addEventListener("click", () => {
    state.settings = { ...DEFAULTS };
    saveSettings();
    syncInputsFromSettings();
    applyFiltersAndRender();
  });

  el.body.addEventListener("click", (e) => {
    const star = e.target.closest("[data-watch]");
    if (star) {
      const id = star.dataset.watch;
      if (state.watch.has(id)) state.watch.delete(id);
      else state.watch.add(id);
      saveWatch();
      applyFiltersAndRender();
      return;
    }
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      const text = copy.dataset.copy;
      navigator.clipboard?.writeText(text).then(
        () => showToast(`Copied "${text}"`),
        () => showToast("Copy failed")
      );
    }
  });

  el.headers.forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.settings.sortKey === key) {
        state.settings.sortDir = state.settings.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.settings.sortKey = key;
        state.settings.sortDir = "desc";
      }
      saveSettings();
      applyFiltersAndRender();
    });
  });
}

/* ---------------- PWA ---------------- */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

/* ---------------- Init ---------------- */
syncInputsFromSettings();
bindControls();
refresh();
