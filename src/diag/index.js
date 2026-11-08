// Public entry. Typical wiring in an app's boot file:
//
//   import { installDiag, maybeMountDiag } from "diag";
//   installDiag();                       // first line of boot: keeps early errors and vitals
//   ...start the app...
//   maybeMountDiag({ app: "punds", release: BUILD_HASH, endpoint: DIAG_ENDPOINT,
//                    quality: () => scene.qualityState(), canvas: () => renderer.domElement });
//
// The panel opens only at the hidden path (default /diag) or with ?diag in the URL.
// Real-user telemetry is separate: startVitals() (see vitals.js).

import { installCapture } from "./capture.js";
import { installVitals } from "./measure.js";

export { collect, preview, flat, SCHEMA_VERSION } from "./report.js";
export { browserFacts, displayFacts, gpuFacts } from "./facts.js";
export { summarizeFrames, percentile } from "./measure.js";
export { scrubUrls, captured } from "./capture.js";
export { mountPanel } from "./panel.js";
export { startVitals, reportTier, flush as flushVitals, buildBeacon } from "./vitals.js";

export function installDiag() {
  installCapture();
  installVitals();
}

export function wantsDiag(path = "/diag", loc = location) {
  if (new URLSearchParams(loc.search).has("diag")) return true;
  const p = loc.pathname.replace(/\/+$/, "") || "/";
  return p === path || p.endsWith(path);
}

export function maybeMountDiag(o) {
  installDiag();
  if (!wantsDiag(o.path, location)) return null;
  // the panel is loaded only here, so normal page views do not pay for it (bundlers split it off)
  const start = () => import("./panel.js").then((m) => m.mountPanel(o));
  // measure the page as visitors see it: after load, once the app had a moment to settle
  const delay = o.settleMs ?? 1500;
  if (document.readyState === "complete") setTimeout(start, delay);
  else addEventListener("load", () => setTimeout(start, delay), { once: true });
  return true;
}
