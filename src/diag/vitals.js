// Real-user telemetry: page vitals with attribution, errors with the release hash,
// and the quality tier the app chose. One beacon per page view, sent when the page
// is hidden; later hides send only errors that came after. No cookies, no storage,
// no identifiers: a beacon cannot be tied to another page view or to a person.
//
//   import { startVitals, reportTier } from "diag";
//   startVitals({ app: "punds", release: BUILD_HASH, endpoint: "https://<host>/v1/beacon",
//                 quality: () => realm.diagState(), gpu: true });
//   reportTier({ tier: "high", scale: 0.9 });   // whenever the app changes its tier

import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals/attribution";
import { browserFacts, gpuFacts, clip, round } from "./facts.js";
import { installCapture, captured } from "./capture.js";
import { flat } from "./report.js";

const KEY = "__diagVitalsBeacon";

function state() {
  const g = globalThis;
  if (!g[KEY]) g[KEY] = { started: false, metrics: {}, tiers: [], sentErrors: 0, sentVitals: false, opts: null };
  return g[KEY];
}

/** The app reports each tier change; the last 10 are kept in order. */
export function reportTier(tier) {
  const s = state();
  const t = flat(tier, 8);
  t.at = Math.round(performance.now());
  s.tiers.push(t);
  if (s.tiers.length > 10) s.tiers.shift();
}

const ATTRIBUTION = {
  LCP: (a) => ({ el: a.target }),
  INP: (a) => ({ el: a.interactionTarget, type: a.interactionType }),
  CLS: (a) => ({ el: a.largestShiftTarget }),
  FCP: () => ({}),
  TTFB: () => ({}),
};

function keep(metric) {
  const extra = ATTRIBUTION[metric.name]?.(metric.attribution ?? {}) ?? {};
  const out = { v: round(metric.value, metric.name === "CLS" ? 4 : 0), rating: metric.rating };
  if (extra.el) out.el = clip(extra.el, 120);
  if (extra.type) out.type = extra.type;
  state().metrics[metric.name.toLowerCase()] = out;
}

// vitals go once per page view, and never for one where the panel was opened
// (they would describe the panel, not the site)
export function buildBeacon(s = state(), withVitals = !s.sentVitals && !globalThis.__diagPanelOpened) {
  const o = s.opts;
  const { errors } = captured();
  const fresh = errors.slice(s.sentErrors, s.sentErrors + 20).map((e) => ({ ...e, stack: e.stack ? e.stack.slice(0, 1000) : null }));
  const nav = performance.getEntriesByType?.("navigation")?.[0];
  const body = {
    v: 1,
    app: clip(o.app, 32),
    release: o.release ? clip(o.release, 40) : null,
    path: clip(location.pathname, 120),
    kind: withVitals ? "view" : "errors",
    browser: browserFacts(),
    dpr: round(devicePixelRatio || 1, 2),
    viewport: [innerWidth, innerHeight],
    errors: fresh,
  };
  if (withVitals) {
    body.nav = nav?.type ?? null;
    body.vitals = { ...s.metrics };
    body.gpu = o.gpu ? (s.gpu ??= gpuFacts().renderer) : null;
    let q = {};
    try {
      q = flat(o.quality?.() ?? {});
    } catch {
      // the app's own getter failing must not cost the beacon
    }
    body.tier = q;
    body.tiers = s.tiers.slice();
  }
  return { body, sentErrors: s.sentErrors + fresh.length };
}

function send(endpoint, body) {
  const text = JSON.stringify(body);
  // text/plain keeps the beacon a simple CORS request (no preflight, which sendBeacon cannot do)
  const blob = new Blob([text], { type: "text/plain;charset=UTF-8" });
  if (navigator.sendBeacon?.(endpoint, blob)) return true;
  try {
    fetch(endpoint, { method: "POST", body: text, keepalive: true, credentials: "omit", referrerPolicy: "no-referrer", headers: { "content-type": "text/plain;charset=UTF-8" } });
    return true;
  } catch {
    return false;
  }
}

export function flush() {
  const s = state();
  if (!s.opts) return false;
  const { body, sentErrors } = buildBeacon(s);
  const withVitals = body.kind === "view";
  if (!withVitals && !body.errors.length) return false;
  if (!send(s.opts.endpoint, body)) return false;
  s.sentVitals = true;
  s.sentErrors = sentErrors;
  return true;
}

/**
 * Start real-user telemetry once per page load.
 * @param {object} o
 * @param {string} o.app
 * @param {string} [o.release]
 * @param {string} o.endpoint   full URL of POST /v1/beacon
 * @param {() => object} [o.quality]
 * @param {boolean} [o.gpu=false]  include the GPU renderer string (WebGL sites)
 * @param {number} [o.sample=1]    share of page views that report, 0..1
 */
export function startVitals(o) {
  const s = state();
  if (s.started) return;
  s.started = true;
  installCapture();
  if ((o.sample ?? 1) < 1 && Math.random() >= o.sample) return;
  s.opts = o;
  const opts = { reportAllChanges: true };
  onLCP(keep, opts);
  onINP(keep, opts);
  onCLS(keep, opts);
  onFCP(keep, opts);
  onTTFB(keep, opts);
  addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  // pagehide covers browsers that skip visibilitychange on unload
  addEventListener("pagehide", () => flush());
}
