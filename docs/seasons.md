# Seasons

A season dresses the garden for a few days or weeks of the year. It changes values the core parts already ask for (light, sky, grass colour, pond, props) and can add parts of its own. Outside its dates a visitor downloads nothing of it.

## Where a season lives

Everything a season owns sits in two folders named after it:

```
src/realm/seasons/<name>/index.ts        the dress, exported as `dress`
src/realm/seasons/<name>/calendar.json   when it is worn
src/realm/seasons/<name>/...             any other code and shaders it needs
public/realm/seasons/<name>/             its assets, posters included
```

The name is lowercase letters, digits and `-`, starting with a letter, and is never `none`. Adding a folder is all it takes: `season.ts` finds the dresses with `import.meta.glob` and loads only the one being worn, and `tools/seasons.mjs` reads the calendars at build time. No shared file names a season.

`calendar.json` holds four keys:

```json
{ "from": [10, 27], "to": [11, 1], "priority": 0, "poster": true }
```

- `from` and `to` are `[month, day]` with months 1 to 12. Both days are included. A range may run over the new year (`[12, 20]` to `[1, 6]`).
- `priority` settles an overlap: the higher one is worn. On a tie the name that sorts first wins.
- `poster` says the season has its own start pictures in `public/realm/seasons/<name>/` (`poster-tall.webp`, `poster-wide.webp`, `poster-wide-4k.webp`). Without them the garden's usual pictures show.

The build stops with a message if a folder has no `index.ts`, no or a broken `calendar.json`, an unknown key, a date out of range, or a poster file missing.

## How the season is picked

The visitor's own clock decides, so a season starts at local midnight everywhere with no deploy at the boundary. The small script in `index.html` picks the season before anything else loads, so the right start picture shows at once, and marks it on the page (`data-season`). `season.ts` reads that mark rather than picking again, so the picture and the garden agree even when the page loads across midnight.

`?season=<name>` shows any season on any day, and `?season=none` shows the garden without one. A name that is not a season is ignored.

If a season's code fails to load, the garden shows undressed. If one of its parts fails to build, that part is left out and the rest of the garden carries on.

## Working on a season

Each season has a long-lived branch of the same name: `halloween`, `christmas`, `spring`, `summer` and `autumn` (listed in `tools/season-branches.json`). The branch is kept after its season for next year's work.

A season branch changes only its own two folders. When it needs something new from a core part, such as a new key that a part asks for with `dressFor`, that change lands on `main` first and does nothing while no season fills it. The season branch then only fills it.

CI checks the rule on every push to a season branch and on every pull request from or into one (`tools/season-scope.mjs`). It works out what landing the branch on `main` would change and fails on anything outside the two folders, including deletions, links and submodules, and paths with anything but plain names. To run it by hand:

```
node tools/season-scope.mjs            on a season branch, against origin/main
```

## Keeping seasons current

Every push to `main` merges `main` into each season branch (`.github/workflows/seasons.yml`, running `tools/season-sync.mjs`). Merges only, never rebases, so nothing published is rewritten.

- A clean merge is pushed, and CI is started on that branch.
- A merge that conflicts is aborted and that branch is left as it was. An issue names the files. The sync never resolves anything itself; in the season's worktree, `git merge main`, settle the files and push.
- A push that comes in while the merge is running is never overwritten; that branch is reported and tried again on the next push to `main`.
- The token Actions provides cannot push changes to workflow files. When `main` changes a workflow, the merge into each season fails with an issue, and is done by hand once.

The same script runs locally, for instance while Actions is not available:

```
node tools/season-sync.mjs             from a clean checkout of main
```

## Going live

1. A few days before the start date, open a pull request from the season branch into `main`.
2. It needs the usual gates (lint, tests, build) and the folder check.
3. Merge, then deploy production by hand. The season switches itself on at each visitor's midnight.

## Ways back

- Roll production back to the previous deployment.
- Take a season out: revert its merge (`git revert -m 1 <merge>`) and deploy.
- A single visitor: `?season=none`.
