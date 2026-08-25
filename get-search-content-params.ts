import type { FindMode } from "./content-find.ts";

export interface GetSearchContentParams {
	responseId: string;
	query?: string;
	queryIndex?: number;
	url?: string;
	urlIndex?: number;
	offset?: number;
	limit?: number;
	findText?: string | string[];
	findMode?: FindMode;
}

type RawGetSearchContentParams = Omit<GetSearchContentParams, "findMode"> & { findMode?: unknown };

function normalizeFindMode(value: unknown): FindMode | undefined {
	if (value === undefined) return undefined;
	if (value === "exact" || value === "case-insensitive" || value === "fuzzy") return value;
	throw new Error('findMode must be "exact", "case-insensitive", or "fuzzy"');
}

export function normalizeGetSearchContentParams(params: RawGetSearchContentParams): GetSearchContentParams {
	// Tool bridges may serialize optional selectors and slice defaults even when unset.
	const normalized: GetSearchContentParams = { ...params, findMode: normalizeFindMode(params.findMode) };

	if (normalized.query?.trim() === "") delete normalized.query;
	if (normalized.url?.trim() === "") delete normalized.url;

	if (normalized.findText !== undefined) {
		delete normalized.offset;
		delete normalized.limit;
	}

	return normalized;
}
