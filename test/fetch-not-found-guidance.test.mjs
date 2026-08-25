import assert from "node:assert/strict";
import { test } from "node:test";

import { extractContent } from "../extract.ts";

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
