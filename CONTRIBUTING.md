# Contributing to Shrine

Thanks for your interest in contributing! This guide covers everything you need to get a change
merged.

By participating in this project you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- [bun](https://bun.sh) (the canonical package manager; version `1.4.2` is used here)

That's it. bun runs the dev server, the build, and the linter; you don't need a separate Node
setup, though Node 22 also works.

## Local setup

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/Shrine.git
cd Shrine

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
| `bun run test`    | Run the Vitest unit tests once (`test:watch` re-runs)               |
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
with a type. Common ones here are `feat:`, `fix:`, `chore:`, `docs:` and `refactor:`.

Real examples from this repository:

```
feat(eye): drop eyelashes, fit iris to the eye opening
fix: shrink the giant eye and give it a real glowing iris
chore: trim gitignore
```

Keep the summary in the imperative mood and reasonably short; add a body if the change needs
more context.

## Quality gate

Before opening a PR, **all three** of these must pass cleanly, the same steps CI runs:

```bash
bun run lint
bun run test
bun run build
```

The TypeScript config is **strict**, with `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`, and `exactOptionalPropertyTypes` enabled. Because `bun run build`
runs `tsc -b`, it **fails on unused locals and parameters**, so clean those up rather than
disabling the rule.

## Testing

Unit tests run under **Vitest**: `bun run test` once, `bun run test:watch` while you work. The
rest is visual, so manual verification in the browser is still expected. A WebGL-capable browser
is required; without WebGL you get the accessible link fallback. For build-affecting changes, also
sanity-check `bun run preview` against the production bundle.

## Licensing

This project is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
By contributing, you agree that your contributions will be licensed under the same terms.

