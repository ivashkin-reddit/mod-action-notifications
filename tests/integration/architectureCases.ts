// The import cases tests/integration/architecture.test.ts lints: each forbidden one must be reported, each allowed one must not.

/** Source code to lint as if it were the content of `file`. */
export interface ImportCase {
    readonly rule: string;
    readonly file: string;
    readonly source: string;
    /** The rule that reports a forbidden case, when not boundaries/dependencies. */
    readonly reportedBy?: string;
}

export const FORBIDDEN_IMPORTS: readonly ImportCase[] = [
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
        rule: "domain code does not import Node",
        file: "src/moderation/domain/modAction.ts",
        source: 'export { readFileSync } from "node:fs";',
    },
    {
        rule: "application code does not import a library",
        file: "src/moderation/application/notifyModAction.ts",
        source: 'export { version } from "typescript";',
    },
    {
        rule: "a .tsx file is held to its layer's rules",
        file: "src/moderation/domain/actionCard.tsx",
        source: 'export * from "../infrastructure/redisModerationRecords.js";',
    },
    {
        rule: "domain code does not fetch",
        file: "src/moderation/domain/modAction.ts",
        source: 'export async function leak(): Promise<Response> { return await fetch("https://example.com"); }',
        reportedBy: "no-restricted-globals",
    },
    {
        rule: "application code does not set a timer through globalThis",
        file: "src/modqueue/application/checkModqueue.ts",
        source: "export const later = globalThis.setTimeout;",
        reportedBy: "no-restricted-properties",
    },
    {
        rule: "a test does not mock the app's own modules",
        file: "tests/integration/bans.test.ts",
        source: [
            'import { vi } from "vitest";',
            'vi.mock("../../src/moderation/infrastructure/redditModeration.js", () => ({}));',
        ].join("\n"),
        reportedBy: "no-restricted-syntax",
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
        rule: "an adapter does not choose how Slack delivers",
        file: "src/modqueue/infrastructure/slackAlerts.ts",
        source: 'export { createWebhookSender } from "../../slack/delivery.js";',
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
        source: 'export * from "../../tests/fixtures/fakeSlack.js";',
    },
    {
        rule: "a unit test does not import another capability",
        file: "src/moderation/domain/discipline.test.ts",
        source: 'export * from "../../modqueue/domain/monitoring.js";',
    },
    {
        rule: "a fixture does not import app code, only its types",
        file: "tests/fixtures/modActions.ts",
        source: 'export { isBlank } from "../../src/moderation/domain/modAction.js";',
    },
    {
        rule: "an integration test does not import a domain type",
        file: "tests/integration/bans.test.ts",
        source: 'export type { ModAction } from "../../src/moderation/domain/modAction.js";',
    },
    {
        rule: "tests reach the app only through main.ts",
        file: "tests/fixtures/app.ts",
        source: 'export * from "../../src/composition.js";',
    },
    {
        rule: "tests do not import a module directly",
        file: "tests/integration/modActionMessage.test.ts",
        source: 'export * from "../../src/moderation/index.js";',
    },
];

export const ALLOWED_IMPORTS: readonly ImportCase[] = [
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
        rule: "the composition root imports Slack's delivery",
        file: "src/composition.ts",
        source: 'export * from "./slack/delivery.js";',
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
        rule: "an integration test imports main.ts, test fixtures and devvit.json",
        file: "tests/integration/registration.test.ts",
        source: [
            'import devvitJson from "../../devvit.json" with { type: "json" };',
            'export * from "../../src/main.js";',
            'export * from "../fixtures/app.js";',
            "export { devvitJson };",
        ].join("\n"),
    },
    {
        rule: "a unit test imports the file beside it and its test tools",
        file: "src/moderation/domain/discipline.test.ts",
        source: ['import { describe } from "vitest";', 'export * from "./discipline.js";', "export { describe };"].join(
            "\n",
        ),
    },
    {
        rule: "a unit test of an adapter imports its module's ports and the test fixtures",
        file: "src/moderation/infrastructure/redisModerationRecords.test.ts",
        source: [
            'export * from "./redisModerationRecords.js";',
            'export type * from "../application/ports.js";',
            'export * from "../../../tests/fixtures/fakeRedis.js";',
        ].join("\n"),
    },
    {
        rule: "a unit test in a shared module imports that module",
        file: "src/slack/outbox.test.ts",
        source: 'export * from "./outbox.js";',
    },
    {
        rule: "a fixture imports domain and application types, to build what a unit test passes in",
        file: "tests/fixtures/modActions.ts",
        source: [
            'export type { ModAction } from "../../src/moderation/domain/modAction.js";',
            'export type { ModerationRecords } from "../../src/moderation/application/ports.js";',
        ].join("\n"),
    },
];
