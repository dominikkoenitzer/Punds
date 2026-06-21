<div align="center">

# Punds

### Everything I do, in one place.

A personal landing page styled as the **NAVI terminal** from *Serial Experiments Lain*.

[**punds.ch**](https://punds.ch/)

[![CI](https://github.com/dominikkoenitzer/Punds/actions/workflows/ci.yml/badge.svg)](https://github.com/dominikkoenitzer/Punds/actions/workflows/ci.yml)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](./LICENSE)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Bun](https://img.shields.io/badge/Bun-1.3-000000?logo=bun&logoColor=white)](https://bun.sh/)

</div>

---

## About

**Punds** is a single-page personal landing page and hub — one place that points at everything I do. It is dressed up as the **NAVI terminal** from the anime *Serial Experiments Lain*: a glowing CRT, scanlines, glitch artifacts, and a boot sequence that hands you a console to poke at.

It is a fan homage. *Serial Experiments Lain* and NAVI are the property of their respective rights holders; this project is non-commercial and exists out of affection for the aesthetic.

The site is intentionally **`noindex` / `nofollow` for every crawler** — search engines and AI bots alike — via meta tags and `robots.txt`. It is deliberately not meant to be indexed; if you found it, you went looking.

> Present day, present time.

## Features

- **CRT presentation** — scanline overlay, screen curvature, and glitch effects for the full cathode-ray feel.
- **Boot sequence** — a NAVI-style power-on log before the interface settles.
- **Canvas oscilloscope** — a self-contained `requestAnimationFrame` waveform renderer, HiDPI-aware and resize-aware.
- **Fake filesystem** — an in-browser tree of "lore" files you can browse and read.
- **Hex-to-ASCII decoder** — paste hex, get plaintext back.
- **Idle quote cycler** — atmospheric lines that rotate while you sit still.
- **Floating intercept messages** — stray transmissions drifting across the screen.
- **Live clock and uptime** — because the terminal is always on.
- **External links column** — pointers to my other sites and profiles.
- **Responsive layout** — a three-column desktop grid that collapses into a mobile tab bar.

## Tech Stack

| Layer            | Choice                                             |
| ---------------- | -------------------------------------------------- |
| Framework        | React 19                                           |
| Language         | TypeScript (strict mode)                           |
| Build tool       | Vite 8                                             |
| Icons            | react-icons                                        |
| Package manager  | Bun 1.3.14                                         |
| Styling          | Hand-written CSS (no Tailwind, no CSS-in-JS)       |

There is **no router, no global state, and no data layer** — all state is local `useState`. Runtime dependencies are just `react`, `react-dom`, and `react-icons`.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (canonical package manager and runner for this project)

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
│   ├── robots.txt                              # disallow all crawlers
│   └── favicon.png
└── src/
    ├── main.tsx                                # React 19 createRoot entry
    ├── App.tsx                                 # renders <Home />
    ├── index.css                               # globals, @font-face, :root color vars
    └── pages/
        ├── Home.tsx                            # the entire UI (~882 lines)
        └── Home.css                            # ~1900 lines of component styling
```

## How It Works / Architecture

The entire interface lives in **one file**: [`src/pages/Home.tsx`](src/pages/Home.tsx). `App.tsx` simply renders `<Home />`, and `main.tsx` is the React 19 `createRoot` entry point. Every piece of state is a local `useState` inside `Home`.

- **Content-driven constants.** The displayed text is driven by constants at the top of `Home.tsx` — `SECRET_FILES`, `BOOT_LINES`, `IDLE_QUOTES`, and `FLOAT_MSGS`. The JSX reads from these, so editing copy means editing data, not markup.
- **The `Oscilloscope` component.** A self-contained canvas component that draws directly with the 2D context inside a `requestAnimationFrame` loop. It is HiDPI-aware via `devicePixelRatio`, resizes through a `ResizeObserver`, and waits on the `TrixieCyrG` font (`document.fonts.load`) before rendering the first frame.
- **The hex decoder.** `handleHexDecode` strips whitespace from the input and parses it two characters at a time into ASCII.
- **Responsive layout.** Desktop is a three-column grid (left = profile + filesystem browser, center = oscilloscope + decoder, right = links). On mobile this collapses into a tab bar driven by `mobileTab` state, with per-column visibility controlled by the **`mv()` helper**.
- **Styling.** All styling is hand-written CSS. Global resets, the `@font-face` for `TrixieCyrG`, and `:root` color variables live in [`src/index.css`](src/index.css); the CRT overlays, glitch keyframes, window chrome, and grid/mobile layout (~1900 lines) live in [`src/pages/Home.css`](src/pages/Home.css).

## Customizing Content

To change what the terminal says, edit the constants at the top of [`src/pages/Home.tsx`](src/pages/Home.tsx) rather than touching the JSX:

| Constant       | Controls                                                  |
| -------------- | -------------------------------------------------------- |
| `SECRET_FILES` | The bodies of the fake filesystem "lore" files.         |
| `BOOT_LINES`   | The lines printed during the boot sequence.             |
| `IDLE_QUOTES`  | The quotes that cycle while the screen is idle.         |
| `FLOAT_MSGS`   | The floating intercept messages that drift across.       |

## Deployment

```bash
bun run build
```

This type-checks and produces a static `dist/` directory containing plain HTML, CSS, JS, and assets. There is no server component, so `dist/` can be deployed to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages, an S3 bucket — anything that serves files).

## License

Licensed under the **Creative Commons Attribution-NonCommercial 4.0 International** license ([CC BY-NC 4.0](./LICENSE)). You are free to share and adapt the material with attribution, but **not** for commercial purposes.

*Serial Experiments Lain* and NAVI are the property of their respective rights holders. This project is an unaffiliated, non-commercial fan homage and claims no ownership over those works.

## Author & Acknowledgements

Built by **Dominik Koenitzer** — [@dominikkoenitzer](https://github.com/dominikkoenitzer) · dominik.koenitzer@gmail.com

If this made you smile, you can support my work via [PayPal](https://www.paypal.com/paypalme/dominikkoenitzer).

With gratitude to the creators of *Serial Experiments Lain* for the aesthetic that inspired it all.

<div align="center">

*Close the world, open the nExt.*

</div>
