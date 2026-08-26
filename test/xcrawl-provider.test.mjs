import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const xcrawlModuleUrl = new URL("../xcrawl.ts", import.meta.url).href;
const searchModuleUrl = new URL("../gemini-search.ts", import.meta.url).href;

async function createHome(config) {
	const home = await mkdtemp(join(tmpdir(), "pi-web-access-xcrawl-"));
	await writeFile(join(home, "web-search.json"), JSON.stringify(config) + "\n", "utf8");
	return home;
}

function runChild(script, env = {}) {
	const childEnv = { ...process.env };
	for (const key of [
		"PI_CODING_AGENT_DIR", "XDG_CONFIG_HOME", "XCRAWL_API_KEY", "OPENAI_API_KEY", "BRAVE_API_KEY",
		"TAVILY_API_KEY", "SERPER_API_KEY", "ANYSEARCH_API_KEY",
	]) delete childEnv[key];
	Object.assign(childEnv, env);
	return spawnSync(process.execPath, ["--input-type=module"], {
		input: script,
		encoding: "utf8",
		env: childEnv,
		maxBuffer: 2 * 1024 * 1024,
	});
}

const sampleEnvelope = {
	search_id: "01KKE8BNMEKRHJB9GEWXPYQ8E1",
	endpoint: "search",
	version: "dca0d4b3bff035e4",
	status: "completed",
	query: "example query",
	data: {
		credits_detail: { base_cost: 2, traffic_cost: 0, json_extract_cost: 0 },
		credits_used: 2,
		data: [
			{ description: "First result snippet.", position: 1, title: "First result", url: "https://example.com/first" },
			{ description: "Second result snippet with no title.", position: 2, title: null, url: "https://example.com/second" },
		],
		endedAt: "2026-03-11T10:51:27.278040Z",
		endpoint: "search",
		job_id: "01KKE8BNMEKRHJB9GEWXPYQ8E1",
		query: "example query",
		request_id: "req-1",
		search_id: "01KKE8BNMEKRHJB9GEWXPYQ8E1",
		site_id: 26,
		startedAt: "2026-03-11T10:51:24.710600Z",
		status: "success",
		success_num: 2,
		uid: "42",
		username: "someone",
		version: "",
	},
	started_at: "",
	ended_at: "",
	total_credits_used: 2,
};

test("XCrawl sends Bearer credentials, normalizes null titles, and supports explicit routing", async () => {
	const home = await createHome({ xcrawlApiKey: "xc-test-key" });
	const child = runChild(`
		const calls = [];
		globalThis.fetch = async (url, init) => {
			calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) });
			return new Response(JSON.stringify(${JSON.stringify(sampleEnvelope)}), { status: 200 });
		};
		const { searchWithXCrawl } = await import(${JSON.stringify(xcrawlModuleUrl)});
		const direct = await searchWithXCrawl("research", { numResults: 7 });
		const { search } = await import(${JSON.stringify(searchModuleUrl)});
		const routed = await search("route", { provider: "xcrawl" });
		console.log(JSON.stringify({ calls, direct, routedProvider: routed.provider }));
	`, { PI_CODING_AGENT_DIR: home });
	assert.equal(child.status, 0, child.stderr);
	const output = JSON.parse(child.stdout.trim());
	assert.equal(output.calls[0].url, "https://run.xcrawl.com/v1/search");
	assert.equal(output.calls[0].headers["authorization"], "Bearer xc-test-key");
	assert.deepEqual(output.calls[0].body, { query: "research", limit: 7 });
	assert.equal(output.direct.results.length, 2);
	assert.equal(output.direct.results[0].title, "First result");
	assert.equal(output.direct.results[1].title, "https://example.com/second");
	assert.equal(output.direct.results[0].snippet, "First result snippet.");
	assert.equal(output.routedProvider, "xcrawl");
});

test("XCrawl forwards optional location and language and bounds limit to the documented maximum", async () => {
	const home = await createHome({ xcrawlApiKey: "xc-test-key" });
	const child = runChild(`
		const calls = [];
		globalThis.fetch = async (url, init) => {
			calls.push({ body: JSON.parse(init.body) });
			return new Response(JSON.stringify(${JSON.stringify(sampleEnvelope)}), { status: 200 });
		};
		const { searchWithXCrawl } = await import(${JSON.stringify(xcrawlModuleUrl)});
		await searchWithXCrawl("localized", { numResults: 500, location: "US", language: "en" });
		console.log(JSON.stringify({ calls }));
	`, { PI_CODING_AGENT_DIR: home });
	assert.equal(child.status, 0, child.stderr);
	const output = JSON.parse(child.stdout.trim());
	assert.deepEqual(output.calls[0].body, { query: "localized", limit: 100, location: "US", language: "en" });
});

test("XCrawl surfaces documented API errors without leaking the key", async () => {
	const home = await createHome({ xcrawlApiKey: "xc-secret-key" });
	const child = runChild(`
		let capturedAuthorization = "";
		globalThis.fetch = async (url, init) => {
			capturedAuthorization = new Headers(init.headers).get("authorization") ?? "";
			return new Response(JSON.stringify({ message: "invalid api key" }), { status: 401 });
		};
		const { searchWithXCrawl } = await import(${JSON.stringify(xcrawlModuleUrl)});
		try {
			await searchWithXCrawl("boom");
			console.log(JSON.stringify({ failed: false }));
		} catch (err) {
			console.log(JSON.stringify({ failed: true, message: String(err.message), capturedAuthorization }));
		}
	`, { PI_CODING_AGENT_DIR: home });
	assert.equal(child.status, 0, child.stderr);
	const output = JSON.parse(child.stdout.trim());
	assert.equal(output.failed, true);
	assert.match(output.message, /XCrawl API error \(401\): invalid api key/);
	assert.ok(!output.message.includes("xc-secret-key"));
	assert.equal(output.capturedAuthorization, "Bearer xc-secret-key");
});

test("XCrawl rejects unexpected envelope shapes instead of returning empty answers silently", async () => {
	const home = await createHome({ xcrawlApiKey: "xc-test-key" });
	const child = runChild(`
		globalThis.fetch = async () => new Response(JSON.stringify({ status: "failed", data: { status: "error", data: [] } }), { status: 200 });
		const { searchWithXCrawl } = await import(${JSON.stringify(xcrawlModuleUrl)});
		try {
			await searchWithXCrawl("shape");
			console.log(JSON.stringify({ failed: false }));
		} catch (err) {
			console.log(JSON.stringify({ failed: true, message: String(err.message) }));
		}
	`, { PI_CODING_AGENT_DIR: home });
	assert.equal(child.status, 0, child.stderr);
	const output = JSON.parse(child.stdout.trim());
	assert.equal(output.failed, true);
	assert.match(output.message, /invalid response/);
});
