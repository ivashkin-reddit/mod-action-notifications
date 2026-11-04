import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

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
]);

const eslint = new ESLint({
    overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
    ruleFilter: ({ ruleId }: Readonly<{ ruleId: string }>): boolean => ARCHITECTURE_RULES.has(ruleId),
});

interface ImportCase {
    readonly rule: string;
    readonly file: string;
    readonly source: string;
}

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

const FORBIDDEN_IMPORTS: readonly ImportCase[] = [
    {
        rule: "domain code does not import Devvit, even its types",
        file: "src/moderation/domain/modAction.ts",
        source: 'export type { TriggerContext } from "@devvit/public-api";',
    },
    {
        rule: "application code does not import Devvit, even its types",
        file: "src/moderation/application/notifyModAction.ts",
        source: 'export type { TriggerContext } from "@devvit/public-api";',
    },
    {
        rule: "an adapter imports only Devvit's types",
        file: "src/moderation/infrastructure/redisModerationRecords.ts",
        source: 'export { Devvit } from "@devvit/public-api";',
    },
    {
        rule: "composition.ts imports only Devvit's types",
        file: "src/composition.ts",
        source: 'export { Devvit } from "@devvit/public-api";',
    },
    {
        rule: "a shared module imports only Devvit's types",
        file: "src/settings/index.ts",
        source: 'export { Devvit } from "@devvit/public-api";',
    },
    {
        rule: "domain code does not import its module's application code",
        file: "src/moderation/domain/modAction.ts",
        source: 'export type * from "../application/ports.js";',
    },
    {
        rule: "domain code does not import its module's adapters",
        file: "src/moderation/domain/modAction.ts",
        source: 'export * from "../infrastructure/redisModerationRecords.js";',
    },
    {
        rule: "domain code does not import another module's domain",
        file: "src/moderation/domain/modAction.ts",
        source: 'export * from "../../modqueue/domain/monitoring.js";',
    },
    {
        rule: "application code does not import its module's adapters",
        file: "src/moderation/application/notifyModAction.ts",
        source: 'export * from "../infrastructure/redisModerationRecords.js";',
    },
    {
        rule: "application code reaches Slack only through its ports",
        file: "src/moderation/application/notifyModAction.ts",
        source: 'export * from "../../slack/index.js";',
    },
    {
        rule: "an adapter imports Slack only through its interface",
        file: "src/moderation/infrastructure/slackModActionAlerts.ts",
        source: 'export * from "../../slack/webhook.js";',
    },
    {
        rule: "an adapter does not import another capability",
        file: "src/moderation/infrastructure/redditModeration.ts",
        source: 'export * from "../../modqueue/index.js";',
    },
    {
        rule: "a capability does not import settings",
        file: "src/modqueue/infrastructure/redisMonitorStore.ts",
        source: 'export * from "../../settings/index.js";',
    },
    {
        rule: "a capability's interface does not import another capability",
        file: "src/moderation/index.ts",
        source: 'export * from "../postDeletion/index.js";',
    },
    {
        rule: "settings imports no other module",
        file: "src/settings/index.ts",
        source: 'export * from "../slack/index.js";',
    },
    {
        rule: "slack imports no other module",
        file: "src/slack/message.ts",
        source: 'export * from "../settings/index.js";',
    },
    {
        rule: "the composition root imports a module only through its index.ts",
        file: "src/composition.ts",
        source: 'export * from "./moderation/infrastructure/redisModerationRecords.js";',
    },
    {
        rule: "modules do not import the composition root",
        file: "src/moderation/application/notifyModAction.ts",
        source: 'export * from "../../composition.js";',
    },
    {
        rule: "production code does not import test support",
        file: "src/slack/webhook.ts",
        source: 'export * from "../../tests/support/fakeSlack.js";',
    },
    {
        rule: "tests reach the app only through main.ts",
        file: "tests/support/app.ts",
        source: 'export * from "../../src/composition.js";',
    },
    {
        rule: "tests do not import a module directly",
        file: "tests/modActionMessage.test.ts",
        source: 'export * from "../src/moderation/index.js";',
    },
];

const ALLOWED_IMPORTS: readonly ImportCase[] = [
    {
        rule: "domain code imports its module's domain",
        file: "src/moderation/domain/discipline.ts",
        source: 'export * from "./modAction.js";',
    },
    {
        rule: "application code imports its module's domain and ports",
        file: "src/moderation/application/notifyModAction.ts",
        source: 'export * from "../domain/modAction.js";\nexport type * from "./ports.js";',
    },
    {
        rule: "an adapter imports Devvit's types and its module's ports",
        file: "src/moderation/infrastructure/redisModerationRecords.ts",
        source: 'export type { TriggerContext } from "@devvit/public-api";\nexport type * from "../application/ports.js";',
    },
    {
        rule: "an adapter imports Slack's interface",
        file: "src/moderation/infrastructure/slackModActionAlerts.ts",
        source: 'export * from "../../slack/index.js";',
    },
    {
        rule: "a capability's interface re-exports its layers",
        file: "src/moderation/index.ts",
        source: 'export * from "./infrastructure/redisModerationRecords.js";',
    },
    {
        rule: "a shared module's files import each other",
        file: "src/slack/webhook.ts",
        source: 'export type * from "./message.js";',
    },
    {
        rule: "the composition root imports a module's interface",
        file: "src/composition.ts",
        source: 'export * from "./moderation/index.js";',
    },
    {
        rule: "main.ts registers with Devvit and imports the composition root",
        file: "src/main.ts",
        source: 'export { Devvit } from "@devvit/public-api";\nexport * from "./composition.js";',
    },
    {
        rule: "a test imports main.ts, test support and devvit.json",
        file: "tests/registration.test.ts",
        source: [
            'import devvitJson from "../devvit.json" with { type: "json" };',
            'export * from "../src/main.js";',
            'export * from "./support/app.js";',
            "export { devvitJson };",
        ].join("\n"),
    },
];

describe("architecture rules", (): void => {
    it.for(FORBIDDEN_IMPORTS)("report that $rule", TEST_OPTIONS, async (importCase: ImportCase): Promise<void> => {
        expect.assertions(1);

        await expect(architectureFindings(importCase)).resolves.toContain("boundaries/dependencies");
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

const SRC = fileURLToPath(new URL("../src", import.meta.url));
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
