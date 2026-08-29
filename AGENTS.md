# AGENTS.md — guidance for AI agents working in this repository

This repository is **RaviEdho/pi-web-access**, a fork of
**nicobailon/pi-web-access** (upstream). It carries two intentional fork
deltas in `index.ts` that **must survive every upstream sync**:

1. `source_check` is disabled by default (commit `cb01cc8`) — reduces schema
   overhead of an unused tool.
2. Tool descriptions and parameter schemas are slimmed to cut per-message
   token cost by ~35% (commit `5a574ed`).

Read **FORK.md** for the full delta listing, exact diffs, and conflict
resolution rules before doing any merge work.

---

## When asked to "sync from upstream" / "fetch upstream" / "merge upstream"

Run the helper script (no push unless the user asked to push):

```bash
./scripts/sync-upstream.sh
```

or with push:

```bash
./scripts/sync-upstream.sh --push
```

The script: ensures the `upstream` remote exists; `git fetch upstream`;
`git merge upstream/main -X ours --no-edit` (conflicting hunks keep the
fork's version); then verifies the four fork markers in `index.ts`.

**Exit 0 + "All fork deltas intact"** → sync is done. Report the upstream
commits that came in (`git log` output is printed by the script).

**Exit 1 / missing markers** → do NOT push. Follow `FORK.md`'s conflict
rules: re-apply the missing delta (`git cherry-pick cb01cc8 5a574ed` if the
commits are still in history, or the inline diffs in FORK.md), re-run the
verification, then continue.

## Manual fallback (script missing or failing)

```bash
git fetch upstream
git merge upstream/main -X ours --no-edit
# then verify:
grep -n 'fork default: disabled' index.ts
grep -n 'Search the web; returns an AI-synthesized' index.ts
grep -n 'Multiple queries, each returns its own answer' index.ts
grep -n 'Video timestamp for frame extraction' index.ts
```

## Hard rules

- **Never accept upstream's long description strings over the fork's short
  ones** — slimmed descriptions are the point of this fork.
- **Never remove the `sourceCheck` default-off line** in `isToolEnabled()` —
  it is intentional. If upstream touches that function, keep the fork's
  version of the conflicting lines.
- **No rebase, no `git reset`, no force-push on `main`** — merge history only.
- `source_check` can be re-enabled per machine via `~/.pi/web-search.json`
  (`{ "tools": { "sourceCheck": { "enabled": true } } }`) — that is the
  supported path; do not flip the code default back.

## Typechecking (before committing code changes)

Local `node_modules` lacks devDependencies, so use:

```bash
npx --yes -p typescript@7.0.2 tsc
```

There is exactly **one pre-existing error** in `extract.ts` about the
`turndown` module's missing type declarations — environmental, unrelated to
any fork work. Do not "fix" it by editing code, and do not report it as a
regression. `index.ts` must compile with zero errors.

## Commit/push etiquette

- Work on `main`; commit messages should reference the fork context when
  relevant (e.g. "perf: …" / "fork:").
- Git identity is configured for this repo already; don't change it.
- After syncing, if upstream merged cleanly and verification passes, a push
  to `origin main` is safe (ask first or use `--push`).