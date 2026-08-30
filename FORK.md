# FORK.md — fork deltas and upstream sync policy

This repository is **RaviEdho/pi-web-access**, a fork of
**[nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access)** (upstream).

It ships **three intentional changes that must survive every upstream sync**.
Each is small and localized, mostly in `index.ts`. Upstream does not (and should
not) receive them — treat upstream's versions of these lines as wrong for
this fork.

---

## Delta 1 — `source_check` disabled by default

Commit: `cb01cc8`

In `isToolEnabled()` (top of `index.ts`), the fork returns `false` for
`sourceCheck` unless a machine explicitly opts in via config. This cuts the
`schema` overhead of an unused tool on every install.

Fork version (keep this):

```ts
function isToolEnabled(config: WebSearchConfig, key: keyof ToolNames): boolean {
	const override = config.tools?.[key]?.enabled;
	if (typeof override === "boolean") return override;
	if (key === "sourceCheck") return false; // fork default: disabled unless explicitly enabled in web-search.json
	return key !== "webSearch" || config.webSearch?.enabled !== false;
}
```

Upstream version (revert to this only if abandoning the fork):

```ts
function isToolEnabled(config: WebSearchConfig, key: keyof ToolNames): boolean {
	const override = config.tools?.[key]?.enabled;
	if (typeof override === "boolean") return override;
	return key !== "webSearch" && key !== "sourceCheck" || config.webSearch?.enabled !== false;
}
```

Machines can still re-enable the tool locally with `~/.pi/web-search.json`:

```json
{ "tools": { "sourceCheck": { "enabled": true } } }
```

## Delta 3 — default search workflow is `auto-summary`, curator disabled

Commit: (current HEAD — see `git log`)

`resolveWorkflow()` (in `index.ts`) now never returns `summary-review`. The
browser curator is therefore never opened by tool calls or config: an unset
`workflow`, an explicit `"summary-review"`, `"auto-summary"`, or any invalid
value all resolve to `auto-summary` (model-generated summary, no curation).
An explicit `"none"` still returns raw results with no summary. The
`/websearch` and `/curator` commands still exist; `/curator` merely writes the
config, and `summary-review` values it writes are neutralized at resolution
time.

Fork version (keep this):

```ts
function resolveWorkflow(input: unknown, hasUI: boolean): WebSearchWorkflow {
	const normalized = typeof input === "string" ? input.trim().toLowerCase() : "";
	if (normalized === "none") return "none";
	// fork: summary-review (browser curator) disabled; anything else, including
	// explicit "summary-review" requests or an unset config, resolves to auto-summary.
	return "auto-summary";
}
```

Upstream version (revert to this only if abandoning the fork):

```ts
function resolveWorkflow(input: unknown, hasUI: boolean): WebSearchWorkflow {
	const normalized = typeof input === "string" ? input.trim().toLowerCase() : "";
	if (normalized === "auto-summary") return "auto-summary";
	if (!hasUI) return "none";
	if (normalized === "none") return "none";
	return "summary-review";
}
```

## Delta 2 — slimmed tool descriptions and parameter schemas

Commit: `5a574ed`

Tool descriptions, prompt snippets, and per-field parameter descriptions for
all four tools (`web_search`, `source_check`, `fetch_content`,
`get_search_content`) were compressed to reduce per-message schema overhead
from ~2,567 to ~1,658 tokens (~35%). Behavioral guidance and enum values were
kept; reference-only prose (provider name lists already present in the enum,
auth requirements, env-var lectures, worked examples) was dropped.

**When merging from upstream, never accept upstream's long description
strings over the fork's short ones** — the verbose variants are exactly what
this fork exists to avoid.

## Syncing from upstream

Preferred — the helper script (fetch + merge with fork-wins policy + delta
verification):

```bash
./scripts/sync-upstream.sh            # merge and verify
./scripts/sync-upstream.sh --push     # also push main to origin
```

Manual equivalent:

```bash
git remote add upstream https://github.com/nicobailon/pi-web-access   # once
git fetch upstream
git merge upstream/main -X ours --no-edit
```

`-X ours` resolves conflicting hunks in favor of the fork; all non-conflicting
upstream changes merge normally. `rerere` is enabled so any hand-resolved
conflict replays automatically in future merges.

## Conflict resolution rules

1. **Conflict in `isToolEnabled`** → keep the fork's `if (key === "sourceCheck") return false;` line.
2. **Conflict in `resolveWorkflow`** → keep the fork's version (never returns `summary-review`; `"none"` honored).
3. **Conflict in any tool description / promptSnippet / field description** → keep the fork's short version (run `git show 5a574ed -- index.ts` for the exact strings).
4. **Upstream removed or restructured something we edited (e.g. moved the whole description block)** → re-apply the fork change on top of the new structure; the anchors below will tell you if it survived.
5. **Never** resolve by force-push, rebase, or `git reset` on `main` — merge history keeps future conflicts small.

## Verification

The sync script checks these anchors; run them manually after any hand-merge
or repair:

```bash
grep -n 'fork default: disabled' index.ts                        # Delta 1 intact
grep -n 'Search the web; returns an AI-synthesized' index.ts     # Delta 2: web_search description
grep -n 'Multiple queries, each returns its own answer' index.ts # Delta 2: queries field
grep -n 'Video timestamp for frame extraction' index.ts          # Delta 2: timestamp field
grep -n 'summary-review (browser curator) disabled' index.ts     # Delta 3: auto-summary default
```

All five must match. If any do not, re-apply the corresponding delta
(`git cherry-pick cb01cc8 5a574ed` works when the commits are still in
history) and re-run verification before committing or pushing.