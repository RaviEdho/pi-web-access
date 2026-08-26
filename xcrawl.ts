import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const XCRAWL_API_URL = "https://run.xcrawl.com/v1/search";
const CONFIG_PATH = getWebSearchConfigPath();
// XCrawl search is an asynchronous job that regularly takes tens of seconds;
// allow more headroom than the typical instant SERP provider.
const SEARCH_TIMEOUT_MS = 90_000;

interface WebSearchConfig {
	xcrawlApiKey?: unknown;
}

interface XCrawlResult {
	description?: unknown;
	position?: unknown;
	title?: unknown;
	url?: unknown;
}

interface XCrawlResponse {
	code?: unknown;
	search_id?: unknown;
	endpoint?: unknown;
	status?: unknown;
	query?: unknown;
	data?: unknown;
	message?: unknown;
	total_credits_used?: unknown;
}

interface XCrawlSearchOptions extends SearchOptions {
	location?: string;
	language?: string;
}

let cachedConfig: WebSearchConfig | null = null;

function loadConfig(): WebSearchConfig {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
		return cachedConfig;
	}

	const raw = readFileSync(CONFIG_PATH, "utf-8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid config in ${CONFIG_PATH}: expected a JSON object`);
	}
	cachedConfig = parsed as WebSearchConfig;
	return cachedConfig;
}

async function getApiKey(signal?: AbortSignal): Promise<string | null> {
	return resolveCredential({
		provider: "XCrawl",
		configuredValue: loadConfig().xcrawlApiKey,
		environmentValue: process.env.XCRAWL_API_KEY,
		signal,
	});
}

export function isXcrawlAvailable(): boolean {
	return true;
}

function normalizeCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 10;
	return Math.max(1, Math.min(Math.floor(value), 100));
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function invalidResponse(message: string): Error {
	return new Error(`XCrawl API returned invalid response: ${message}`);
}

interface ParsedEnvelope {
	results: { title: string; url: string; snippet: string }[];
}

function parseResponse(value: unknown): ParsedEnvelope {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidResponse("expected an object envelope");
	}
	const envelope = value as XCrawlResponse;
	if (envelope.status !== "completed") {
		throw invalidResponse(`expected status \"completed\", got ${JSON.stringify(envelope.status ?? null)}`);
	}
	if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
		throw invalidResponse("expected data object");
	}
	const data = envelope.data as Record<string, unknown>;
	if (data.status !== undefined && data.status !== "success") {
		throw invalidResponse(`expected data.status \"success\", got ${JSON.stringify(data.status)}`);
	}
	if (!Array.isArray(data.data)) throw invalidResponse("expected data.data array");

	const results: ParsedEnvelope["results"] = [];
	for (const [index, value] of (data.data as unknown[]).entries()) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw invalidResponse(`expected data.data[${index}] object`);
		}
		const result = value as XCrawlResult;
		const { title, url, description } = result;
		if (typeof url !== "string" || !url) throw invalidResponse(`expected data.data[${index}].url to be a non-empty string`);
		if (title !== null && title !== undefined && typeof title !== "string") {
			throw invalidResponse(`expected data.data[${index}].title to be a string or null`);
		}
		if (description !== undefined && description !== null && typeof description !== "string") {
			throw invalidResponse(`expected data.data[${index}].description to be a string or null`);
		}
		results.push({
			title: typeof title === "string" && title.trim().length > 0 ? title : url,
			url,
			snippet: typeof description === "string" ? description : "",
		});
	}

	return { results };
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results
		.map((result) => result.snippet
			? `${result.snippet}\nSource: ${result.title} (${result.url})`
			: `Source: ${result.title} (${result.url})`)
		.join("\n\n");
}

export async function searchWithXCrawl(query: string, options: XCrawlSearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await getApiKey(options.signal);
	if (!apiKey) {
		throw new Error(
			"XCrawl search requires an API key. Set xcrawlApiKey in " + CONFIG_PATH +
			" or export XCRAWL_API_KEY. Get one at https://dash.xcrawl.com/",
		);
	}
	const numResults = normalizeCount(options.numResults);
	const body: Record<string, unknown> = { query, limit: numResults };
	if (typeof options.location === "string" && options.location.trim()) body.location = options.location.trim();
	if (typeof options.language === "string" && options.language.trim()) body.language = options.language.trim();
	const activityId = activityMonitor.logStart({ type: "api", query });
	let response: Response;

	try {
		response = await fetch(XCRAWL_API_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: options.signal
				? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal])
				: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
		});
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (redactedMessage.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}

	if (!response.ok) {
		activityMonitor.logComplete(activityId, response.status);
		const errorText = redactCredential(await response.text(), apiKey);
		let detail = errorText.slice(0, 300);
		try {
			const parsed = JSON.parse(errorText) as { message?: unknown; error?: unknown };
			if (typeof parsed.message === "string") detail = parsed.message.slice(0, 300);
			else if (typeof parsed.error === "string") detail = parsed.error.slice(0, 300);
		} catch {
			// keep raw text slice
		}
		throw new Error(`XCrawl API error (${response.status}): ${detail}`);
	}
	activityMonitor.logComplete(activityId, response.status);

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (err) {
		throw invalidResponse(`response body is not valid JSON: ${errorMessage(err)}`);
	}
	const { results } = parseResponse(payload);

	return {
		answer: buildAnswer(results),
		results,
	};
}
