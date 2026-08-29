#!/usr/bin/env bash
# sync-upstream.sh — fetch upstream (nicobailon/pi-web-access) and merge into main,
# keeping fork deltas on conflicts (-X ours), then verify the fork markers survived.
#
# Usage:
#   ./scripts/sync-upstream.sh           # fetch + merge + verify (no push)
#   ./scripts/sync-upstream.sh --push    # also push main to origin when verification passes
#
# Exit codes: 0 = merged and all fork deltas intact; 1 = merge failed or a delta is missing.

set -euo pipefail

UPSTREAM_URL="https://github.com/nicobailon/pi-web-access"

# Anchors that must exist in index.ts after any upstream merge (see FORK.md).
FORK_ANCHORS=(
  "fork default: disabled"                        # cb01cc8: source_check disabled by default
  "Search the web; returns an AI-synthesized"     # 5a574ed: slimmed web_search description
  "Multiple queries, each returns its own answer" # 5a574ed: slimmed queries field
  "Video timestamp for frame extraction"          # 5a574ed: slimmed timestamp field
)

PUSH=0
if [ "${1:-}" = "--push" ]; then
	PUSH=1
fi

cd "$(dirname "$0")/.."

# --- preconditions ---------------------------------------------------------
branch=$(git symbolic-ref --short HEAD 2>/dev/null || true)
if [ "$branch" != "main" ]; then
	echo "error: not on main (current: ${branch:-detached}). Sync only on main." >&2
	exit 1
fi
if ! git diff --quiet; then
	echo "error: working tree dirty — commit or stash before syncing." >&2
	exit 1
fi

git config rerere.enabled true

# --- upstream remote -------------------------------------------------------
if ! git remote get-url upstream >/dev/null 2>&1; then
	echo "Adding upstream remote: $UPSTREAM_URL"
	git remote add upstream "$UPSTREAM_URL"
fi

# --- fetch + merge ---------------------------------------------------------
echo "Fetching upstream..."
git fetch upstream

before=$(git rev-parse HEAD)
echo "Merging upstream/main (-X ours: conflicting hunks keep the fork's version)..."
echo
if ! git merge upstream/main -X ours --no-edit; then
	echo >&2
	echo "!!! merge stopped with unresolved conflicts !!!" >&2
	echo "Resolve manually with fork deltas winning (rules in FORK.md), then:" >&2
	echo "    git add <files> && git commit" >&2
	echo "rerere is enabled, so your resolutions replay automatically on future merges." >&2
	exit 1
fi
echo
echo "Commits brought in from upstream:"
git log --oneline --no-merges "$before..HEAD" || true

# --- verify fork deltas ----------------------------------------------------
echo
echo "Verifying fork deltas in index.ts..."
missing=0
for anchor in "${FORK_ANCHORS[@]}"; do
	if grep -qF -- "$anchor" index.ts; then
		echo "  ok:   $anchor"
	else
		echo "  MISSING: $anchor — fork delta lost in merge! Re-apply it (see FORK.md)." >&2
		missing=1
	fi
done

if [ "$missing" -ne 0 ]; then
	echo >&2
	echo "!!! One or more fork deltas are missing — do NOT push until fixed. !!!" >&2
	exit 1
fi

echo
echo "All fork deltas intact."

if [ "$PUSH" -eq 1 ]; then
	git push origin main
	echo "Pushed main to origin."
else
	echo "Not pushed (pass --push to push main to origin after review)."
fi