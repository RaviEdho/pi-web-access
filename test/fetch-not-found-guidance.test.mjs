import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { extractContent } from "../extract.ts";

const extractUrl = new URL("../extract.ts", import.meta.url).href;
const originalFetch = globalThis.fetch;
const lookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("404 drops the provider checklist and points at search", async (t) => {
	t.after(() => { globalThis.fetch = originalFetch; });
	globalThis.fetch = async () => new Response("gone", { status: 404, statusText: "Not Found" });

	const result = await extractContent("https://example.com/missing-page", undefined, { lookup });

	assert.equal(result.status, 404);
	assert.match(result.error, /HTTP 404: Not Found/);
	assert.doesNotMatch(result.error, /Fallback options:/);
	assert.match(result.error, /web_search/);
});

test("410 gets the same not-found guidance", async (t) => {
	t.after(() => { globalThis.fetch = originalFetch; });
	globalThis.fetch = async () => new Response("gone", { status: 410, statusText: "Gone" });

	const result = await extractContent("https://example.com/retired", undefined, { lookup });

	assert.equal(result.status, 410);
	assert.doesNotMatch(result.error, /Fallback options:/);
	assert.match(result.error, /web_search/);
});

test("transient errors keep the fallback checklist", async (t) => {
	t.after(() => { globalThis.fetch = originalFetch; });
	globalThis.fetch = async () => new Response("broken", { status: 500, statusText: "Internal Server Error" });

	const result = await extractContent("https://example.com/oops", undefined, { lookup });

	assert.equal(result.status, 500);
	assert.match(result.error, /Fallback options:/);
});

test("guidance uses the configured public tool names", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-fetch-404-names-"));
	await writeFile(
		join(root, "web-search.json"),
		JSON.stringify({ toolNames: { webSearch: "webfinder", fetchContent: "pageget" } }) + "\n",
		"utf8",
	);
	const childEnv = { ...process.env, PI_CODING_AGENT_DIR: root, HOME: root, USERPROFILE: root };
	for (const key of [
		"FIRECRAWL_BASE_URL", "FIRECRAWL_API_KEY", "PARALLEL_API_KEY", "TINYFISH_API_KEY",
		"SEARCH1API_KEY", "SEARCH1API_API_KEY", "QUERIT_API_KEY", "KAGI_API_KEY", "OLLAMA_API_KEY",
		"BRIGHTDATA_API_KEY", "BRIGHTDATA_UNLOCKER_ZONE", "GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "GOOGLE_API_KEY",
	]) delete childEnv[key];

	const child = spawnSync(process.execPath, ["--input-type=module"], {
		input: `
			globalThis.fetch = async () => new Response("gone", { status: 404, statusText: "Not Found" });
			const { extractContent } = await import(${JSON.stringify(extractUrl)});
			const result = await extractContent("https://example.com/missing-page", undefined, { lookup: async () => [{ address: "93.184.216.34", family: 4 }] });
			console.log(JSON.stringify(result));
		`,
		encoding: "utf8",
		env: childEnv,
		maxBuffer: 2 * 1024 * 1024,
	});
	assert.equal(child.status, 0, child.stderr);

	const result = JSON.parse(child.stdout.trim());
	assert.equal(result.status, 404);
	assert.match(result.error, /webfinder/);
	assert.match(result.error, /pageget/);
	assert.doesNotMatch(result.error, /web_search/);
});
