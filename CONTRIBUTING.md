# Contributing to Punds

Thanks for your interest in contributing! Punds is a single-page personal landing page styled
as Copland OS / the NAVI from *Serial Experiments Lain* — a navigable Three.js 3D world you
boot into. This guide covers everything you need to get a change merged.

By participating in this project you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- [bun](https://bun.sh) (the canonical package manager — version `1.3.14` is used here)

That's it. bun runs the dev server, the build, and the linter; you don't need a separate Node
setup, though Node 22 also works.

## Local setup

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/Punds.git
cd Punds

# 2. Install dependencies
bun install

# 3. Start the dev server (port 1000, exposed on the network via host: true)
bun run dev
```

Open http://localhost:1000 to see the site. The dev server hot-reloads on save.

### Available commands

| Command           | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `bun run dev`     | Start the Vite dev server on **port 1000** (`host: true`)           |
| `bun run build`   | Type-check all project refs (`tsc -b`) then build the bundle        |
| `bun run lint`    | Run ESLint over the repo                                            |
| `bun run preview` | Serve the built `dist/` locally                                     |

## Branch & PR workflow

1. **Fork** the repository (or, if you have push access, create a branch directly).
2. Create a **descriptively named branch** off `main`, e.g. `feat/network-graph-node`,
   `fix/bloom-flicker`, or `docs/readme-tweaks`.
3. Make your changes, committing with [Conventional Commits](#commit-messages).
4. Make sure the [quality gate](#quality-gate) passes.
5. Open a **pull request against `main`**. Describe what changed and why; include a screenshot
   or short clip if the change is visual.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). Prefix each commit
with a type — common ones here are `feat:`, `fix:`, `chore:`, `docs:`, and `refactor:`.

Real examples from this repository:

```
feat(eye): drop eyelashes, fit iris to the eye opening
fix: shrink the giant eye and give it a real glowing iris
docs: add CLAUDE.md guidance for Claude Code
```

Keep the summary in the imperative mood and reasonably short; add a body if the change needs
more context.

## Quality gate

Before opening a PR, **both** of these must pass cleanly:

```bash
bun run lint
bun run build
```

The TypeScript config is **strict**, with `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`, and `exactOptionalPropertyTypes` enabled. Because `bun run build`
runs `tsc -b`, it **fails on unused locals and parameters** — clean those up rather than
disabling the rule.

## Testing

There is **no test runner** configured. Manual verification in the browser is expected: run
`bun run dev`, then watch the full boot sequence (logo → boot log → "present day, present time"
→ desktop) and exercise the part you touched — drag to look around, scroll to fly, hover and
click the floating panels. A WebGL-capable browser is required; without WebGL you get the
accessible link fallback. For build-affecting changes, also sanity-check `bun run preview`
against the production bundle.

## Code conventions

The app is a thin **React layer** over a self-contained **Three.js scene engine**. Entry chain:
[`src/main.tsx`](src/main.tsx) → [`src/App.tsx`](src/App.tsx) renders `<CoplandOS/>` →
[`src/pages/CoplandOS.tsx`](src/pages/CoplandOS.tsx). There is no router, no global state, and no
data layer — React state is local `useState` inside `CoplandOS`.

- **Know which layer you're in.** [`CoplandOS.tsx`](src/pages/CoplandOS.tsx) drives the boot
  phase machine (`logo` → `boot` → `welcome` → `desktop`) and the DOM overlays (CRT layers, HUD,
  boot log, the accessible no-WebGL fallback). The 3D world lives in
  [`src/scene/coplandScene.ts`](src/scene/coplandScene.ts) (the `CoplandScene` class) and its
  feature modules — touch the scene there, not in React.
- **Features implement a contract.** Each module in [`src/scene/features/`](src/scene/features)
  implements `SceneFeature { group, update(ctx), dispose() }` (see
  [`features/types.ts`](src/scene/features/types.ts)). To add one, implement the interface and
  register it in `CoplandScene.buildFeatures()`. Always `dispose()` geometries/materials you
  create — the scene tears itself down on unmount and must not leak GPU resources.
- **Edit content/config data, not scene code.** The floating links live in
  [`src/scene/panelData.ts`](src/scene/panelData.ts) (`PANEL_DATA`); the boot log and operator
  name are constants at the top of [`CoplandOS.tsx`](src/pages/CoplandOS.tsx).
- **Styling is 100% hand-written CSS** — no Tailwind, no CSS-in-JS. Global resets and the
  `TrixieCyrG` `@font-face` live in [`src/index.css`](src/index.css); the scene colour-palette
  `:root` variables (read back by the 3D engine via `getComputedStyle`) and all overlay/HUD
  styling live in [`src/pages/CoplandOS.css`](src/pages/CoplandOS.css). Retune the palette there
  and the 3D follows.
- **Every `useEffect` timer or event listener must return its own cleanup.** The scene
  lifecycle, clock, boot orchestration, NAVI whispers, and keyboard shortcuts each set up and
  tear down their own interval/listener — follow that pattern when adding one.
- **Add runtime dependencies deliberately.** The only runtime deps today are `react`,
  `react-dom`, and `three`. Prefer reaching for those (or plain CSS/canvas) before adding
  anything new to `package.json`.

## Licensing

This project is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
By contributing, you agree that your contributions will be licensed under the same terms.

*Serial Experiments Lain* and NAVI are the property of their respective rights holders; this
project is an unaffiliated fan homage.
