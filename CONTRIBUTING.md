# Contributing to Punds

Thanks for your interest in contributing! Punds is a single-page personal landing page styled
as the NAVI terminal from *Serial Experiments Lain*. This guide covers everything you need to
get a change merged.

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
2. Create a **descriptively named branch** off `main`, e.g. `feat/idle-quote-cycler`,
   `fix/oscilloscope-resize`, or `docs/readme-tweaks`.
3. Make your changes, committing with [Conventional Commits](#commit-messages).
4. Make sure the [quality gate](#quality-gate) passes.
5. Open a **pull request against `main`**. Describe what changed and why; include a screenshot
   or short clip if the change is visual.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). Prefix each commit
with a type — common ones here are `feat:`, `fix:`, `chore:`, `docs:`, and `refactor:`.

Real examples from this repository:

```
feat: enhance Home component with oscilloscope and floating messages
docs: add CLAUDE.md guidance for Claude Code
chore: migrate to bun, remove LinkedIn, prune dead CSS
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
`bun run dev`, exercise the part of the UI you touched, and confirm it behaves on both desktop
(the 3-column grid) and mobile (the tab bar). For build-affecting changes, also sanity-check
`bun run preview` against the production bundle.

## Code conventions

- **The entire UI lives in one file: [`src/pages/Home.tsx`](src/pages/Home.tsx).** `App.tsx`
  just renders `<Home/>`. There is no router, no global state, and no data layer — all state is
  local `useState` inside `Home`.
- **Edit content constants, not JSX.** Displayed text is driven by top-of-file constants —
  `SECRET_FILES` (the fake filesystem bodies), `BOOT_LINES`, `IDLE_QUOTES`, and `FLOAT_MSGS`.
  Change these to update content rather than touching the markup.
- **Styling is 100% hand-written CSS** — no Tailwind, no CSS-in-JS. Component styling lives in
  [`src/pages/Home.css`](src/pages/Home.css); global resets, the `@font-face` for the custom
  `TrixieCyrG` font, and the `:root` color variables live in [`src/index.css`](src/index.css).
- **Every `useEffect` timer or event listener must return its own cleanup.** The boot sequence,
  idle-quote cycler, cursor trail, clock, uptime, and floating intercepts each set up and tear
  down their own interval/listener — follow that pattern when adding one.
- **Add runtime dependencies deliberately.** The only runtime deps today are `react`,
  `react-dom`, and `react-icons`. Prefer reaching for those (or plain CSS/canvas) before adding
  anything new to `package.json`.
- **Mobile layout** is controlled by the `mv()` helper and `mobileTab` state — reuse them when
  adding a new pane rather than rolling bespoke visibility logic.

## Licensing

This project is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
By contributing, you agree that your contributions will be licensed under the same terms.

*Serial Experiments Lain* and NAVI are the property of their respective rights holders; this
project is an unaffiliated fan homage.
