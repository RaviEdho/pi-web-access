import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import initializeExtension from "../index.ts";

const indexSrc = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const readmeSrc = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("web_search registration is gated by webSearch.enabled", () => {
	assert.match(indexSrc, /webSearch\?: \{\n\t\tenabled\?: boolean;\n\t\};/);
	assert.match(indexSrc, /if \(initConfig\.webSearch\?\.enabled !== false\) pi\.registerTool\(\{\n\t\tname: "web_search"/);
});

test("fetch tools remain registered outside the web_search gate", () => {
	const gateIndex = indexSrc.indexOf("if (initConfig.webSearch?.enabled !== false)");
	const fetchIndex = indexSrc.indexOf('name: "fetch_content"');
	assert.ok(gateIndex >= 0, "web_search gate not found");
	assert.ok(fetchIndex > gateIndex, "fetch_content registration should remain after web_search gate");
	assert.match(indexSrc, /\n\t}\);\n\n\tpi\.registerTool\(\{\n\t\tname: "fetch_content"/);
});

test("web activity shortcut renders through the supported string-array API", async () => {
	const shortcuts = [];
	initializeExtension({
		registerTool() {},
		registerCommand() {},
		registerShortcut(name, shortcut) { shortcuts.push({ name, shortcut }); },
		on() {},
	});

	const activityShortcut = shortcuts.find(({ shortcut }) => shortcut.description === "Toggle web search activity");
	assert.ok(activityShortcut, "activity shortcut was not registered");
	const widgets = [];
	const ctx = {
		ui: {
			theme: { fg: (_color, text) => text },
			setWidget(key, content) { widgets.push({ key, content }); },
		},
	};

	await activityShortcut.shortcut.handler(ctx);
	assert.equal(widgets[0].key, "web-activity");
	assert.ok(Array.isArray(widgets[0].content), "activity widget content must be a string array");
	assert.ok(widgets[0].content.length > 0);

	await activityShortcut.shortcut.handler(ctx);
});

test("README documents webSearch.enabled", () => {
	assert.match(readmeSrc, /"webSearch": \{\n    "enabled": true\n  \}/);
	assert.match(readmeSrc, /webSearch\.enabled` to `false` to unregister the `web_search` tool/);
});
