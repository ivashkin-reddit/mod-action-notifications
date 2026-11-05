import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ALLOWED_IMPORTS, FORBIDDEN_IMPORTS } from "./architectureCases.js";
import type { ImportCase } from "./architectureCases.js";

// Lints imports that break the architecture, and imports it must keep allowing, through the project's own ESLint
// config. A dependency upgrade or config change that stops a boundary rule from firing fails here rather than
// passing lint silently. Only the architecture rules run, without type information.

// Loading the full ESLint config (every plugin) takes seconds on a cold start; each case after that takes milliseconds.
const TEST_OPTIONS = { timeout: 30_000 };

const ARCHITECTURE_RULES = new Set([
    "boundaries/dependencies",
    "boundaries/no-ignored-dependencies",
    "boundaries/no-unknown-dependencies",
    "boundaries/no-unknown-files",
    "import-x/no-cycle",
    "no-restricted-globals",
    "no-restricted-properties",
    "no-restricted-syntax",
]);

const eslint = new ESLint({
    overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
    ruleFilter: ({ ruleId }: Readonly<{ ruleId: string }>): boolean => ARCHITECTURE_RULES.has(ruleId),
});

/** The architecture rules that report `source`, linted as if it were the content of `file`. */
async function architectureFindings(importCase: ImportCase): Promise<string[]> {
    const results = await eslint.lintText(importCase.source, { filePath: importCase.file });
    const ruleIds: string[] = [];
    for (const result of results) {
        for (const message of result.messages) {
            if (message.ruleId !== null) {
                ruleIds.push(message.ruleId);
            }
        }
    }

    return ruleIds;
}

describe("architecture rules", (): void => {
    it.for(FORBIDDEN_IMPORTS)("report that $rule", TEST_OPTIONS, async (importCase: ImportCase): Promise<void> => {
        expect.assertions(1);

        await expect(architectureFindings(importCase)).resolves.toContain(
            importCase.reportedBy ?? "boundaries/dependencies",
        );
    });

    it.for(ALLOWED_IMPORTS)("allow that $rule", TEST_OPTIONS, async (importCase: ImportCase): Promise<void> => {
        expect.assertions(1);

        await expect(architectureFindings(importCase)).resolves.toStrictEqual([]);
    });

    it("report an import cycle within a layer", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        // banDuration.ts imports isBlank from modAction.ts.
        await expect(
            architectureFindings({
                rule: "files do not import each other in a cycle",
                file: "src/moderation/domain/modAction.ts",
                source: 'export { parseBanDuration } from "./banDuration.js";',
            }),
        ).resolves.toStrictEqual(["import-x/no-cycle"]);
    });
});

// eslint-plugin-boundaries assigns a file to the nearest folder its element patterns match, so a file directly in a
// capability's folder, or in a folder beside its layers, would count as the capability's interface and escape the
// layer rules. These tests keep src to the layout the rules assume.

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
// The composition root.
const EDGE_FILES = ["composition.ts", "main.ts"];
// Modules without layers: each is its own files, importing only each other.
const SHARED_MODULES = ["settings", "slack"];
// A capability module: its interface and its three layers.
const CAPABILITY_ENTRIES = ["application", "domain", "index.ts", "infrastructure"];

function byText(first: string, second: string): number {
    return first.localeCompare(second);
}

function entriesOf(folder: string): readonly string[] {
    return readdirSync(folder).sort(byText);
}

function isFolder(entry: string): boolean {
    return statSync(path.join(SRC, entry)).isDirectory();
}

describe("the layout of src", (): void => {
    it("holds only the composition root's files and module folders", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(entriesOf(SRC).filter((entry): boolean => !isFolder(entry))).toStrictEqual(EDGE_FILES);
    });

    it("gives every module but the shared ones an index.ts and three layers", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const capabilities = entriesOf(SRC).filter(
            (entry): boolean => isFolder(entry) && !SHARED_MODULES.includes(entry),
        );

        expect(
            capabilities.map((capability): readonly [string, readonly string[]] => [
                capability,
                entriesOf(path.join(SRC, capability)),
            ]),
        ).toStrictEqual(
            capabilities.map((capability): readonly [string, readonly string[]] => [capability, CAPABILITY_ENTRIES]),
        );
    });
});
