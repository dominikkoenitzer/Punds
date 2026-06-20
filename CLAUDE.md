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

A single-page personal landing page styled as the **NAVI terminal from *Serial Experiments Lain***: CRT/scanline/glitch effects, a boot sequence, a canvas oscilloscope, a fake filesystem of lore files, a hex decoder, and a column of external links. It is intentionally `noindex` for all crawlers (see the meta tags in `index.html`).

## Architecture

The entire UI lives in **one file**: [src/pages/Home.tsx](src/pages/Home.tsx). [src/App.tsx](src/App.tsx) just renders `<Home />`, and [src/main.tsx](src/main.tsx) is the React 19 `createRoot` entry. There is no router, no global state, and no data layer — every piece of state is local `useState` inside `Home`.

Key structure within `Home.tsx`:
- **Top-of-file constants** drive the content: `SECRET_FILES` (the fake FS file bodies), `BOOT_LINES`, `IDLE_QUOTES`, `FLOAT_MSGS`. Edit these to change displayed text rather than touching JSX.
- **`Oscilloscope`** is a self-contained canvas component. It draws directly with the 2D context inside a `requestAnimationFrame` loop, handles HiDPI via `devicePixelRatio`, resizes through a `ResizeObserver` on its parent, and waits for the `TrixieCyrG` font (`document.fonts.load`) before the first frame. All animation state (glitch/dropout/phase) is local to the effect — no React state per frame.
- **`Home`** wires up several `setInterval`/event-listener effects (boot sequence, idle-quote cycling, cursor trail, clock, uptime, floating intercepts). Each effect returns its own cleanup; keep that pattern when adding timers.
- The **hex decoder** (`handleHexDecode`) parses whitespace-stripped hex input two chars at a time into ASCII.

### Responsive / layout convention
Desktop is a 3-column grid (left = profile + filesystem browser, center = oscilloscope + decoder, right = links). Mobile collapses to a tab bar driven by `mobileTab` state. Visibility is controlled by the **`mv()` helper**, which returns a `mobile-hidden` class for columns/windows not matching the active tab — follow this when adding a new pane. The filesystem browser additionally swaps between a tree pane and viewer pane on mobile via `mobileFsPane`.

## Styling

All styling is **hand-written CSS** — no Tailwind or CSS-in-JS. Global resets, the `@font-face` for the custom `TrixieCyrG` font, and the `:root` color variables live in [src/index.css](src/index.css); essentially all component styling (~1900 lines: CRT overlays, glitch keyframes, window chrome, grid/mobile layout) lives in [src/pages/Home.css](src/pages/Home.css), imported by `Home.tsx`. The font file is in `public/fonts/` and is preloaded in `index.html`.

Note: only `react`, `react-dom`, and `react-icons` are declared runtime dependencies (plus the dev toolchain: Vite, TypeScript, ESLint). Add a dependency to `package.json` deliberately if you need one.

## TypeScript

Strict mode is on with extra checks enabled in [tsconfig.app.json](tsconfig.app.json): `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, and `exactOptionalPropertyTypes`. `tsc -b` (run as part of `build`) will fail on unused locals/params, so clean those up rather than disabling the rule.
