import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const skillSrc = readFileSync(new URL("../skills/librarian/SKILL.md", import.meta.url), "utf8");

test("librarian skill uses the reported clone path instead of a hardcoded path", () => {
	assert.doesNotMatch(skillSrc, /\/tmp\/pi-github-repos\/owner\/repo/);
	assert.doesNotMatch(skillSrc, /\/tmp\/pi-github-repos\//);
	assert.match(skillSrc, /Repository cloned to:/);
	assert.match(skillSrc, /test -d \"\$repo_path\"/);
	assert.match(skillSrc, /call \*\*fetch_content\*\* again/);
	assert.match(skillSrc, /paths are session-scoped/);
	assert.match(skillSrc, /githubClone\.clonePath/);
});
