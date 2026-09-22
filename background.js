"use strict";

/*
 * Uncontain
 * ---------
 * Goal: a URL you type into the address bar of a container tab should load in the
 * default ("No Container") environment, while everything the page itself causes --
 * link clicks, form posts, 30x and JS redirects, OAuth/3-D-Secure/payment handovers --
 * stays inside the current container.
 *
 * The discriminator: a page-initiated navigation carries `originUrl` / `documentUrl`
 * (the initiating document). A URL entered in the address bar has neither.
 * Redirect hops inherit the initiator, so a Shopping -> PSP handover is never touched.
 */

const DEFAULT_STORE = "firefox-default";
const PRIVATE_STORE = "firefox-private";

const DEFAULTS = {
  // "preempt": cancel the request before it is sent, so the container never
  //            sees a single byte of the typed site. Recommended.
  // "commit":  let it start, then move it. Uses webNavigation.transitionType.
  //            Fallback in case "preempt" misclassifies something in your setup.
  mode: "preempt",

  // Keep the original container tab on its current page (true), or close it (false).
  keepOriginalTab: true,

  // Never break out of a container for these hosts, even when typed.
  // Subdomains are included. Useful for intranet/SSO hosts you always want contained.
  hostAllowlist: [],

  // Only break out when the typed host's registrable part differs from the host
  // currently shown in the tab. Typing "amazon.de/gp/orders" inside Shopping then
  // stays in Shopping. Recommended, and works nicely together with
  // Multi-Account Containers site assignments.
  onlyWhenSiteDiffers: true,

  // Ignore container tabs younger than this (ms). Prevents ping-pong with
  // Multi-Account Containers, which reopens assigned sites in a *fresh* tab
  // (also without originUrl).
  newTabGraceMs: 2000,

  // Ignore everything for this long after browser/extension start, so session
  // restore does not get scattered across the default container.
  // Kept short on purpose: restored tabs are additionally protected by
  // newTabGraceMs, because tabs.onCreated fires for them during session restore.
  startupGraceMs: 5000,

  // Verbose logging to the extension console (about:debugging -> Inspect).
  debug: false,
};

let cfg = { ...DEFAULTS };
const startedAt = Date.now();

function log(...a) {
  if (cfg.debug) console.log("[uncontain]", ...a);
}
function skip(why, extra) {
  log("skip:", why, extra === undefined ? "" : extra);
  return null;
}

browser.storage.local.get("cfg").then((v) => {
  if (v && v.cfg) cfg = { ...DEFAULTS, ...v.cfg };
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.cfg) cfg = { ...DEFAULTS, ...changes.cfg.newValue };
});

/* ---------- per-tab bookkeeping ---------- */

const tabBorn = new Map();          // tabId -> timestamp
const tabSeen = new Map();          // tabId -> Set(url)  (for reload / back-forward)
const tabPrevUrl = new Map();       // tabId -> url committed before the current one

browser.tabs.onCreated.addListener((tab) => tabBorn.set(tab.id, Date.now()));
browser.tabs.onRemoved.addListener((id) => {
  tabBorn.delete(id);
  tabSeen.delete(id);
  tabPrevUrl.delete(id);
});

// Registered first on purpose: bookkeeping runs before the "commit" mode handler.
browser.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0) return;
  let seen = tabSeen.get(d.tabId);
  if (!seen) tabSeen.set(d.tabId, (seen = new Set()));
  const cur = stripRef(d.url);
  if (!seen.has(cur)) {
    const last = [...seen].pop();
    if (last) tabPrevUrl.set(d.tabId, last);
  }
  seen.add(cur);
  if (seen.size > 60) seen.delete(seen.values().next().value);
});

/* ---------- helpers ---------- */

function stripRef(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString();
  } catch (_) {
    return u;
  }
}

function host(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

// Cheap registrable-domain approximation; good enough for "same site?" checks.
// Handles the common two-label public suffixes (co.uk, com.au, ...).
const TWO_LABEL_SUFFIX = /\.(co|com|net|org|gov|ac|edu|or|ne|go)\.[a-z]{2}$/;
function site(hostname) {
  if (!hostname || /^[\d.]+$/.test(hostname)) return hostname;
  const parts = hostname.split(".");
  const want = TWO_LABEL_SUFFIX.test(hostname) ? 3 : 2;
  return parts.slice(-want).join(".");
}

function allowlisted(hostname) {
  return cfg.hostAllowlist.some(
    (h) => hostname === h.toLowerCase() || hostname.endsWith("." + h.toLowerCase())
  );
}

function isContainer(storeId) {
  return storeId && storeId !== DEFAULT_STORE && storeId !== PRIVATE_STORE;
}

/**
 * Decide whether this top-level navigation looks like something the *user* typed
 * rather than something the page caused.
 */
async function shouldBreakOut(d, pageInitiated, opts = {}) {
  if (Date.now() - startedAt < cfg.startupGraceMs)
    return skip("startup grace", `${Date.now() - startedAt}ms since load`);
  if (d.tabId == null || d.tabId < 0) return skip("no tabId");
  if (d.frameId !== 0) return skip("subframe");
  if (pageInitiated)
    return skip("page-initiated", `originUrl=${d.originUrl} documentUrl=${d.documentUrl}`);
  if (d.method && d.method !== "GET") return skip("method", d.method);

  const target = stripRef(d.url);
  if (!/^https?:/.test(target)) return skip("scheme", target);

  const born = tabBorn.get(d.tabId);
  if (born && Date.now() - born < cfg.newTabGraceMs)
    return skip("new-tab grace", `${Date.now() - born}ms old`);  // MAC reopen etc.

  if (!opts.ignoreSeen) {
    const seen = tabSeen.get(d.tabId);
    if (seen && seen.has(target)) return skip("already visited in tab", target);
  }

  let tab;
  try {
    tab = await browser.tabs.get(d.tabId);
  } catch (e) {
    return skip("tabs.get failed", String(e));
  }
  if (!isContainer(tab.cookieStoreId)) return skip("tab not in a container", tab.cookieStoreId);

  const fromUrl = opts.fromUrl || tab.url || "";
  if (!/^https?:/.test(fromUrl)) return skip("no http page in tab yet", fromUrl);

  const h = host(target);
  if (allowlisted(h)) return skip("host allowlisted", h);
  if (cfg.onlyWhenSiteDiffers && site(h) === site(host(fromUrl)))
    return skip("same site", `${site(host(fromUrl))} -> ${site(h)}`);

  log("BREAK OUT", `${fromUrl} -> ${target}`, `store=${tab.cookieStoreId}`);
  return tab;
}

async function moveToDefault(tab, url) {
  await browser.tabs.create({
    url,
    cookieStoreId: DEFAULT_STORE,
    windowId: tab.windowId,
    index: tab.index + 1,
    active: true,
  });
  if (!cfg.keepOriginalTab) {
    try {
      await browser.tabs.remove(tab.id);
    } catch (_) {}
  }
}

/* ---------- mode 1: preempt (cancel before the container touches it) ---------- */

browser.webRequest.onBeforeRequest.addListener(
  (d) => {
    log("main_frame", d.url, {
      method: d.method,
      originUrl: d.originUrl,
      documentUrl: d.documentUrl,
      tabId: d.tabId,
      frameId: d.frameId,
      mode: cfg.mode,
    });
    if (cfg.mode !== "preempt") return;
    const pageInitiated = Boolean(d.originUrl || d.documentUrl);
    // Returning a Promise from a blocking listener is supported in Firefox.
    return shouldBreakOut(d, pageInitiated).then((tab) => {
      if (!tab) return {};
      moveToDefault(tab, d.url);
      return { cancel: true };
    });
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
  ["blocking"]
);

/* ---------- mode 2: commit (fallback, uses transitionType) ---------- */

const TYPED_TRANSITIONS = new Set(["typed", "generated", "keyword", "keyword_generated"]);

browser.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId === 0) log("committed", d.url, "transitionType=" + d.transitionType, d.transitionQualifiers);
  if (cfg.mode !== "commit") return;
  if (d.frameId !== 0) return;
  if (!TYPED_TRANSITIONS.has(d.transitionType)) return;
  if ((d.transitionQualifiers || []).some((q) => q.includes("redirect"))) return;

  const tab = await shouldBreakOut({ ...d, method: "GET" }, false, {
    ignoreSeen: true,
    fromUrl: tabPrevUrl.get(d.tabId),
  });
  if (!tab) return;
  // Send the tab back where it came from, then open the typed URL uncontained.
  try {
    await browser.tabs.goBack(tab.id);
  } catch (_) {}
  moveToDefault(tab, d.url);
});
