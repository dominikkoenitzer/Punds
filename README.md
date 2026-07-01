<div align="center">

# Punds

### Everything I do, in one place.

A personal landing page styled as **Copland OS / the NAVI** from *Serial Experiments Lain* — a navigable 3D world you boot into.

[**punds.ch**](https://punds.ch/)

[![CI](https://github.com/dominikkoenitzer/Punds/actions/workflows/ci.yml/badge.svg)](https://github.com/dominikkoenitzer/Punds/actions/workflows/ci.yml)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](./LICENSE)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-r185-000000?logo=three.js&logoColor=white)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Bun](https://img.shields.io/badge/Bun-1.3-000000?logo=bun&logoColor=white)](https://bun.sh/)

</div>

---

## About

**Punds** is a single-page personal landing page and hub — one place that points at everything I do. It is dressed up as **Copland OS**, the NAVI operating system from the anime *Serial Experiments Lain*: a CRT-styled boot sequence powers on, the NAVI greets you with "present day, present time", and you drop into a full-screen, navigable **3D world** rendered with Three.js. Floating holographic link panels orbit a glowing eye/circuit logo inside a fog-bound inner world. **Drag to look around, scroll to fly through.**

It is a fan homage. *Serial Experiments Lain* and the NAVI are the property of their respective rights holders; this project is non-commercial and exists out of affection for the aesthetic.

The site is intentionally **`noindex` / `nofollow` for every crawler** — search engines and AI bots alike — via meta tags and `robots.txt`. It is deliberately not meant to be indexed; if you found it, you went looking.

> Present day, present time.

## Features

- **3D NAVI world** — a full-screen Three.js scene you navigate: drag to look, scroll to fly/dolly through fog-bound depth.
- **Boot theatre** — a logo splash, a streaming Copland OS boot log, and a "present day / present time" operator welcome before the desktop settles.
- **NAVI voice** — low-pitched Web Speech utterances greet you on boot and whisper intermittently as you sit still.
- **Floating link panels** — billboarded holographic cards orbit the central logo; click one and the camera "dives" into it and opens the link.
- **Living scene** — a reflective floor, an inverted mirror-city overhead ("as above, so below"), data rain, drifting koi, a network graph you can "jack into", watching eyes, a giant eye, terminal text, and more — each a self-contained feature module.
- **Cinematic post-processing** — bloom, glitch warps on layer changes, ACES tone mapping, and a phosphor flicker.
- **Ambient audio** — a low Web Audio drone whose bass level breathes through the visuals (press **M** to mute).
- **Idle "dread"** — sit still and the fog, audio, and whispers slowly intensify.
- **Adaptive quality** — an FPS sampler auto-steps quality tiers up and down so it stays smooth.
- **Accessible fallback** — a screen-reader / no-WebGL layer exposes the real links as plain HTML.
- **CRT presentation** — scanline, grain, and vignette overlays plus a four-corner HUD.

## Tech Stack

| Layer            | Choice                                             |
| ---------------- | -------------------------------------------------- |
| Framework        | React 19                                           |
| 3D / rendering   | Three.js (r185) + EffectComposer post-processing   |
| Audio / voice    | Web Audio API + Web Speech API                     |
| Language         | TypeScript (strict mode)                           |
| Build tool       | Vite 8                                             |
| Package manager  | Bun 1.3.14                                         |
| Styling          | Hand-written CSS (no Tailwind, no CSS-in-JS)       |

There is **no router, no global state, and no data layer** — React state is local `useState`. Runtime dependencies are just `react`, `react-dom`, and `three`.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (canonical package manager and runner for this project)
- A WebGL-capable browser (the scene needs WebGL/WebGL2; without it you get the accessible link fallback)

### Install and run

```bash
# install dependencies
bun install

# start the dev server
bun run dev
```

The dev server runs on **http://localhost:1000** and is exposed on the network (`host: true`), so you can reach it from other devices on your LAN too.

## Available Scripts

| Script            | What it does                                                              |
| ----------------- | ------------------------------------------------------------------------ |
| `bun run dev`     | Start the Vite dev server on port **1000**, exposed on the network.      |
| `bun run build`   | Type-check all project references (`tsc -b`), then build to `dist/`.      |
| `bun run lint`    | Run ESLint over the repository.                                          |
| `bun run preview` | Serve the built `dist/` locally to preview the production bundle.        |

> There is no test runner configured.

## Project Structure

```
.
├── index.html                                  # HTML entry — noindex meta tags, font preload
├── vite.config.ts                              # Vite config (port 1000, host: true)
├── package.json                                # scripts and dependencies (Bun)
├── bun.lock
├── tsconfig*.json                              # TypeScript project references (strict)
├── eslint.config.js
├── public/
│   ├── fonts/
│   │   └── TrixieCyrG-Plain-Regular.otf        # custom NAVI font
│   └── robots.txt                              # disallow all crawlers
└── src/
    ├── main.tsx                                # React 19 createRoot entry (StrictMode)
    ├── App.tsx                                 # renders <CoplandOS />
    ├── index.css                               # globals, @font-face, base :root vars
    ├── App.css                                 # #root full-viewport sizing
    ├── pages/
    │   ├── CoplandOS.tsx                       # React layer: boot phases + DOM overlays
    │   └── CoplandOS.css                       # scene palette vars + overlay/HUD styling
    └── scene/                                  # the Three.js engine
        ├── coplandScene.ts                     # CoplandScene class (renderer, camera, post, loop)
        ├── audioEngine.ts                      # ambient Web Audio drone + bass analyser
        ├── naviVoice.ts                        # Web Speech "NAVI" utterances
        ├── panelData.ts                        # the floating link panels' content
        └── features/                           # ~15 SceneFeature visual modules
            ├── types.ts                        # SceneFeature / ScenePalette / FeatureContext
            ├── innerSky.ts   reflectiveFloor.ts   sidewaysCity.ts
            ├── cables.ts     dataRain.ts          dataSpires.ts
            ├── fish.ts       rain.ts              watcher.ts
            ├── wiredIntercepts.ts   watchingEyes.ts   apparition.ts
            ├── giantEye.ts   terminalText.ts      networkGraph.ts
            └── …
```

## How It Works / Architecture

The app is a thin **React layer** over a self-contained **Three.js scene engine**.

`main.tsx` is the React 19 `createRoot` entry (in `StrictMode`); it renders `App.tsx`, which renders [`CoplandOS`](src/pages/CoplandOS.tsx). There is no router, no global state, and no data layer.

- **The React layer ([`CoplandOS.tsx`](src/pages/CoplandOS.tsx))** drives a boot **phase machine** — `logo` → `boot` (streaming boot log) → `welcome` ("present day / present time" + a NAVI voice greeting) → `desktop` (the HUD). It constructs and disposes the 3D scene in a `useEffect`, wires its hover/click handlers, and renders the crisp **DOM overlays** the canvas sits behind: CRT scan/grain/vignette, the four-corner HUD with a live clock and a hover focus label, and the boot/welcome theatre. It also renders an accessible **screen-reader / no-WebGL fallback** containing the real links. The heavy 3D scene is **lazy-loaded** so this boot shell paints first. Tapping during boot skips to the desktop; `M` mutes the audio.
- **The scene engine ([`coplandScene.ts`](src/scene/coplandScene.ts))** is the `CoplandScene` class: a `WebGLRenderer` + `PerspectiveCamera` and an `EffectComposer` post chain (`RenderPass` → `UnrealBloomPass` → `GlitchPass` → `OutputPass`). It builds the central logo, a drifting particle field, the billboarded link panels, and all feature modules, then runs a `requestAnimationFrame` loop. A **camera rig** lets you drag to look and scroll to fly; a `Raycaster` drives panel hover/click (clicking a link panel dives the camera in and opens the link, clicking a network-graph node "jacks in" a layer deeper). An **idle "dread"** value ramps up while you hold still, and an **FPS-driven auto quality** system steps tiers up and down. The colour palette is read from CSS custom properties, so retuning the CSS retunes the 3D.
- **Feature modules ([`src/scene/features/`](src/scene/features))** each implement `SceneFeature { group, update(ctx), dispose() }`: `InnerSky`, `ReflectiveFloor`, `SidewaysCity`, `CableTangle`, `DataRain`, `DataSpires`, `HolographicFish` (koi), `InnerRain`, `Watcher`, `WiredIntercepts`, `WatchingEyes`, `Apparition`, `GiantEye`, `TerminalText`, and `NetworkGraph` — plus a vertical **mirror twin** of the city overhead. `CoplandScene` adds each group, calls `update` every frame, and `dispose`s on teardown.
- **Audio & voice.** [`audioEngine.ts`](src/scene/audioEngine.ts) is an ambient Web Audio drone with a bass analyser the scene reads each frame to drive the bloom and particles; [`naviVoice.ts`](src/scene/naviVoice.ts) is a Web Speech wrapper for the NAVI's utterances.
- **Styling.** Hand-written CSS only. Global resets, the `TrixieCyrG` `@font-face`, and base `:root` vars live in [`src/index.css`](src/index.css); `#root` sizing in [`src/App.css`](src/App.css); the scene colour-palette `:root` variables (read back by the 3D engine) and all overlay/HUD/boot styling live in [`src/pages/CoplandOS.css`](src/pages/CoplandOS.css).

## Customizing Content

To change the links the floating panels point at, edit [`src/scene/panelData.ts`](src/scene/panelData.ts) — each entry is a `PanelDatum` with a `label`, `href`, and a few display `lines`. To retune the visual palette (and the 3D scene with it), edit the `:root` custom properties at the top of [`src/pages/CoplandOS.css`](src/pages/CoplandOS.css). The boot log lines and the operator name live as constants at the top of [`src/pages/CoplandOS.tsx`](src/pages/CoplandOS.tsx).

## Deployment

```bash
bun run build
```

This type-checks and produces a static `dist/` directory containing plain HTML, CSS, JS, and assets. There is no server component, so `dist/` can be deployed to any static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages, an S3 bucket — anything that serves files).

## License

Licensed under the **Creative Commons Attribution-NonCommercial 4.0 International** license ([CC BY-NC 4.0](./LICENSE)). You are free to share and adapt the material with attribution, but **not** for commercial purposes.

*Serial Experiments Lain* and the NAVI are the property of their respective rights holders. This project is an unaffiliated, non-commercial fan homage and claims no ownership over those works.

## Author & Acknowledgements

Built by **Dominik Koenitzer** — [@dominikkoenitzer](https://github.com/dominikkoenitzer) · dominik.koenitzer@gmail.com

If this made you smile, you can support my work via [PayPal](https://www.paypal.com/paypalme/dominikkoenitzer).

With gratitude to the creators of *Serial Experiments Lain* for the aesthetic that inspired it all.

<div align="center">

*Close the world, open the nExt.*

</div>
