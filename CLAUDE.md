# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **bun** (see `bun.lock`).

- `bun run dev` — start the Vite dev server on **port 1000**, exposed on the network (`host: true`)
- `bun run build` — type-check all project references (`tsc -b`) then produce the production bundle (`vite build`)
- `bun run lint` — run ESLint over the repo
- `bun run preview` — serve the built `dist/` locally

There is no test runner configured.

## What this is

A single-page personal landing page styled as **Copland OS / the NAVI from *Serial Experiments Lain***: a navigable, full-screen **Three.js 3D world** you boot into. A CRT-styled boot sequence ("present day, present time") hands you a desktop where floating holographic link panels orbit a central eye/circuit logo inside a fog-bound inner world (reflective floor, an inverted mirror-city overhead, data rain, koi, watching eyes, a giant eye, a network graph you can "jack into", etc.). Drag to look, scroll to fly. It is intentionally `noindex` / `nofollow` for all crawlers (meta tags in `index.html` plus `public/robots.txt`).

## Architecture

The app is split into a thin **React layer** and a self-contained **Three.js scene engine**.

Entry chain: [src/main.tsx](src/main.tsx) (React 19 `createRoot` in `StrictMode`, imports `index.css` + `App.css`) → [src/App.tsx](src/App.tsx) renders `<CoplandOS />` → [src/pages/CoplandOS.tsx](src/pages/CoplandOS.tsx). There is no router, no global state, and no data layer — React state is local `useState` inside `CoplandOS`.

### React layer — `src/pages/CoplandOS.tsx`
- Drives a **boot phase machine**: `logo` → `boot` (streaming boot log) → `welcome` (the "present day / present time" splash + a `NaviVoice` greeting) → `desktop` (the HUD). Tapping during boot skips straight to `desktop` (via the scene's `onActivate`).
- Owns the scene lifecycle: **lazy-imports** (`await import('../scene/coplandScene')`) and constructs a `CoplandScene` in a `useEffect` so the boot shell paints before three loads, wires its handlers (`onActivate`, `onHover`), and disposes it on unmount.
- Renders the **crisp DOM overlays** the WebGL canvas sits behind: CRT scan/grain/vignette layers, the four corner HUD readouts + hover focus label, the boot wordmark/log, and the operator welcome.
- Renders a **screen-reader / no-WebGL fallback** (`.copland-sr` / `.copland-fallback`) containing the real links from `PANEL_DATA`, so the page is meaningful without WebGL.
- Wires several `setInterval`/event-listener effects (clock, boot orchestration timers, NAVI whispers that get more frequent with idle "dread", `M` toggles audio mute). Each effect returns its own cleanup — keep that pattern.

### Scene engine — `src/scene/`
- **`coplandScene.ts`** hosts the `CoplandScene` class: a `THREE.WebGLRenderer` + `PerspectiveCamera` + an `EffectComposer` post chain (`RenderPass` → `UnrealBloomPass` → `GlitchPass` → `OutputPass`). It builds the central logo, the drifting particle field, the billboarded link panels, and all feature modules; runs the `requestAnimationFrame` loop; and exposes `setPhase`, `setMuted`, `setQuality`, `getDread`, `start`, `dispose`. Key systems:
  - **Camera rig** — drag to look (yaw/pitch), scroll to fly/dolly, idle auto-drift, pointer parallax. A `Raycaster` drives panel hover/click; clicking a link panel "dives" toward it and opens its `href`, clicking a network-graph node "jacks in" a layer deeper.
  - **Idle "dread"** — ramps 0→1 the longer the viewer is perfectly still, deepening fog, audio, and NAVI whispers.
  - **Auto quality tiers** — an FPS sampler steps an `ultra`/`high`/`low` tier up/down (pixel-ratio cap, bloom scale, MSAA samples, and dropping the heaviest objects — the reflective floor, mirror twin, sideways city, koi — on `low`).
  - **Palette** — read from CSS custom properties via `getComputedStyle(document.documentElement)`, so retuning the CSS vars retunes the 3D.
- **`features/`** — ~15 visual modules, each implementing `SceneFeature { group, update(ctx), dispose() }` from [features/types.ts](src/scene/features/types.ts). The host adds each `group` to the scene, calls `update(ctx)` every frame, and `dispose()` on teardown. Current modules: `InnerSky`, `ReflectiveFloor`, `SidewaysCity`, `CableTangle` (cables.ts), `DataRain`, `DataSpires`, `HolographicFish` (fish.ts — koi), `InnerRain` (rain.ts), `Watcher`, `WiredIntercepts`, `WatchingEyes`, `Apparition`, `GiantEye`, `TerminalText`, `NetworkGraph`. Plus a vertical **mirror twin** of the city (`makeVerticalMirror` of the spires, "as above, so below") added directly in `buildFeatures`. To add a feature, implement `SceneFeature` and register it in `CoplandScene.buildFeatures()`.
- **`audioEngine.ts`** — `AudioEngine`: an ambient Web Audio drone (detuned saws → lowpass, slow LFO) plus a bass analyser whose `level()` the scene reads each frame to drive bloom/particles. Must be `resume()`d from a user gesture; `setMuted` / `setDread` retune it.
- **`naviVoice.ts`** — `NaviVoice`: a thin Web Speech wrapper for low-pitched "NAVI" utterances; no-ops where speech is unavailable.
- **`panelData.ts`** — `PANEL_DATA`, the floating panels' content. Currently four link panels: `PERSONAL_SITE`, `JOURNAL`, `REPOSITORY`, `TRANSFER`. Edit this to change links/labels rather than touching scene code.

## Styling

All styling is **hand-written CSS** — no Tailwind or CSS-in-JS.
- [src/index.css](src/index.css) — global resets, the `@font-face` for the custom `TrixieCyrG` font, and some legacy `:root` vars; sets the html/body to fixed full-viewport (with mobile scroll overrides).
- [src/App.css](src/App.css) — sizes `#root` to the full fixed viewport.
- [src/pages/CoplandOS.css](src/pages/CoplandOS.css) — the **scene color palette** as `:root` custom properties (`--copland-void`, `--copland-horizon`, `--phosphor`, `--hologram`, `--tachibana`, `--warning`, …) that the Three.js scene reads back via `getComputedStyle`, plus all DOM overlay styling: CRT scan/grain/vignette, the boot theatre, and the HUD.

The font file lives in `public/fonts/` and is preloaded in `index.html`. There is no favicon.

Note: runtime dependencies are only `react`, `react-dom`, and `three` (`react-icons` was removed). Dev toolchain: Vite 8, TypeScript, ESLint, `@types/three`, `@vitejs/plugin-react`. Add a dependency to `package.json` deliberately if you need one.

## TypeScript

Strict mode is on with extra checks enabled in [tsconfig.app.json](tsconfig.app.json): `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, and `exactOptionalPropertyTypes`. `tsc -b` (run as part of `build`) will fail on unused locals/params, so clean those up rather than disabling the rule.
