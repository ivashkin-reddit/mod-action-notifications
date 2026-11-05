import path from "node:path";
import { defineConfig } from "eslint/config";
import { createConfig } from "eslint-plugin-boundaries/config";

// Architecture, as AGENTS.md ("Architecture") describes it, enforced by eslint-plugin-boundaries: every file under
// src and tests belongs to an element, and an import between elements is an error unless a policy below allows it.
// Policies are evaluated in order and the last one that matches decides.

// Every extension TypeScript compiles, so a .tsx or .mts file is held to the same rules as a .ts one.
const TYPESCRIPT = "{ts,tsx,mts,cts}";

/** @type {import("eslint-plugin-boundaries").ElementDescriptors} */
const ELEMENTS = [
    // A capability module's three layers: pure rules, use cases with their ports, and adapters.
    { type: "domain", pattern: "src/*/domain", capture: ["module"], partialMatch: false },
    { type: "application", pattern: "src/*/application", capture: ["module"], partialMatch: false },
    { type: "infrastructure", pattern: "src/*/infrastructure", capture: ["module"], partialMatch: false },
    // The rest of a module: a capability's index.ts, or every file of a shared module (settings, slack).
    { type: "module", pattern: "src/*", capture: ["module"], partialMatch: false },
    // The files directly under src: main.ts, which registers with Devvit, and composition.ts, which builds adapters.
    { type: "edge", pattern: "src", partialMatch: false },
    // Integration tests and the fixtures they share.
    { type: "tests", pattern: "tests", partialMatch: false },
];

/** A unit test beside the file it tests, `<file>.test.ts`: part of that file's element, and of this category. */
const UNIT_TEST = "unit-test";

const SAME_MODULE = { module: "{{from.element.captured.module}}" };
const INTERFACE = "index.ts";
/** Slack's second interface: the outbox and direct sending, for the composition root alone. */
const SLACK_DELIVERY = "delivery.ts";
const PRODUCTION = ["domain", "application", "infrastructure", "module", "edge"];

/** @type {import("eslint-plugin-boundaries").DependenciesPolicy[]} */
const policies = [
    // Libraries are open to adapters and the composition root; Devvit is restricted below, and domain and application
    // code import none.
    { allow: { to: { module: { origin: ["external", "core"] } } } },
    {
        from: { element: { type: PRODUCTION } },
        disallow: { to: { module: { source: "@devvit/*" } }, dependency: { kind: "value" } },
        message: "Only src/main.ts registers with Devvit; elsewhere import Devvit's types only.",
    },
    {
        from: { element: { type: "edge", fileInternalPath: "main.ts" } },
        allow: { to: { module: { source: "@devvit/public-api" } } },
    },
    {
        from: { element: { type: ["domain", "application"] } },
        disallow: { to: { module: { origin: ["external", "core"] } } },
        message:
            "Domain and application code import no library, Devvit and Node included ({{dependency.source}}); an adapter does, behind a port.",
    },

    // Domain: its own module's domain files.
    { from: { element: { type: "domain" } }, allow: { to: { element: { type: "domain", captured: SAME_MODULE } } } },
    // Application: its own module's domain and application files, never its adapters.
    {
        from: { element: { type: "application" } },
        allow: { to: { element: { type: ["domain", "application"], captured: SAME_MODULE } } },
    },
    // Infrastructure: its own module's layers, and the slack module's interface.
    {
        from: { element: { type: "infrastructure" } },
        allow: {
            to: [
                { element: { type: ["domain", "application", "infrastructure"], captured: SAME_MODULE } },
                { element: { type: "module", captured: { module: "slack" }, fileInternalPath: INTERFACE } },
            ],
        },
    },
    // A capability's index.ts re-exports its own layers; a shared module's files import each other. Neither imports
    // another module: capabilities never depend on each other, and settings and slack depend on no module.
    { from: { element: { type: "module" } }, allow: { to: { element: { captured: SAME_MODULE } } } },
    // The composition root: any module's interface, Slack's delivery (which only the root chooses), and the rest of
    // the root.
    {
        from: { element: { type: "edge" } },
        allow: {
            to: [
                { element: { type: "module", fileInternalPath: INTERFACE } },
                { element: { type: "module", captured: { module: "slack" }, fileInternalPath: SLACK_DELIVERY } },
                { element: { type: "edge" } },
            ],
        },
    },

    // Production code never imports a test or a fixture, and nothing imports a unit test, so none reaches the bundle
    // Devvit builds from main.ts...
    {
        disallow: { to: [{ element: { type: "tests" } }, { file: { categories: UNIT_TEST } }] },
        message: "Only tests import a test fixture, and nothing imports a unit test ({{dependency.source}}).",
    },
    // ...while integration tests reach the app only through what main.ts registers, plus fixtures, devvit.json and
    // libraries...
    {
        from: { element: { type: "tests" } },
        allow: {
            to: [
                { element: { type: "edge", fileInternalPath: "main.ts" } },
                { element: { type: "tests" } },
                { file: { categories: "devvit-config" } },
                { module: { origin: ["external", "core"] } },
            ],
        },
    },
    // ...and a unit test reaches the module it sits in, any of its layers, plus fixtures and libraries: it may test
    // a domain file with vitest, or an adapter with a fake.
    {
        from: { file: { categories: UNIT_TEST } },
        allow: {
            to: [
                { element: { type: ["domain", "application", "infrastructure", "module"], captured: SAME_MODULE } },
                { element: { type: "tests" } },
                { module: { origin: ["external", "core"] } },
            ],
        },
    },
    // A fixture may name a domain or application type, to build the values and ports a unit test passes in. A type
    // import leaves nothing at run time, so integration tests still reach the app only through main.ts.
    {
        from: { element: { type: "tests", fileInternalPath: "fixtures/**" } },
        allow: { to: { element: { type: ["domain", "application"] } }, dependency: { kind: "type" } },
    },
];

const ARCHITECTURE_FILES = [`src/**/*.${TYPESCRIPT}`, `tests/**/*.${TYPESCRIPT}`];
const CORE_FILES = [`src/*/domain/**/*.${TYPESCRIPT}`, `src/*/application/**/*.${TYPESCRIPT}`];

// The I/O and timers the Devvit runtime (lib WebWorker) puts in scope without an import.
const IO_GLOBALS = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "caches",
    "indexedDB",
    "importScripts",
    "navigator",
    "crypto",
    "postMessage",
    "setTimeout",
    "setInterval",
];
const IO_MESSAGE = "Domain and application code do no I/O; an adapter does, behind a port.";
/** @type {{ name: string, message: string }[]} */
const IO_GLOBAL_NAMES = [];
/** @type {{ object: string, property: string, message: string }[]} */
const IO_GLOBAL_PROPERTIES = [];
for (const name of IO_GLOBALS) {
    IO_GLOBAL_NAMES.push({ name, message: IO_MESSAGE });
    for (const object of ["globalThis", "self"]) {
        IO_GLOBAL_PROPERTIES.push({ object, property: name, message: IO_MESSAGE });
    }
}

// vi.mock and its relatives name a module by a string, which import rules do not read.
const MOCKING =
    "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock|importActual|importMock)$/]";
const SRC_PATH = "/(^|\\/)src\\//";

export const architecture = defineConfig(
    {
        files: ARCHITECTURE_FILES,
        rules: {
            // The policies keep imports between modules and layers one-way; this also covers files within a layer.
            // It skips type-only imports, which leave no import at run time; boundaries still checks their direction.
            "import-x/no-cycle": "error",
        },
        // eslint-plugin-boundaries resolves imports through eslint-module-utils, which reads this legacy setting.
        settings: { "import/resolver": { typescript: true } },
    },
    {
        // Importing no library (the policies below) leaves the globals: these reach outside the process too. A unit test
        // beside the code may use them, fake timers included.
        files: CORE_FILES,
        ignores: [`src/**/*.test.${TYPESCRIPT}`],
        rules: {
            "no-restricted-globals": ["error", ...IO_GLOBAL_NAMES],
            "no-restricted-properties": ["error", ...IO_GLOBAL_PROPERTIES],
        },
    },
    {
        // Tests reach the app only through main.ts (the policies below), mocks included.
        files: [`tests/**/*.${TYPESCRIPT}`],
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    selector: `${MOCKING} > Literal[value=${SRC_PATH}]`,
                    message: "Tests mock Devvit, not the app's own modules: they reach the app only through main.ts.",
                },
                {
                    selector: `${MOCKING} > TemplateLiteral > TemplateElement[value.raw=${SRC_PATH}]`,
                    message: "Tests mock Devvit, not the app's own modules: they reach the app only through main.ts.",
                },
            ],
        },
    },
    // createConfig registers the plugin, and accepts only its own settings and rules.
    createConfig({
        files: ARCHITECTURE_FILES,
        settings: {
            "boundaries/root-path": path.resolve(import.meta.dirname, ".."),
            "boundaries/elements": ELEMENTS,
            // devvit.json, which a test checks against what the app registers, and unit tests beside the code.
            "boundaries/files": [
                { pattern: "devvit.json", category: "devvit-config" },
                { pattern: `src/**/*.test.${TYPESCRIPT}`, category: UNIT_TEST },
            ],
        },
        rules: {
            "boundaries/dependencies": [
                "error",
                {
                    checkAllOrigins: true,
                    // Also check imports between files of one element, such as two domain files.
                    checkInternals: true,
                    default: "disallow",
                    message:
                        "{{from.element.types.[0]}} code may not import {{dependency.source}} ({{to.element.types.[0]}}); see Architecture in AGENTS.md.",
                    policies,
                },
            ],
            "boundaries/no-ignored-dependencies": "error",
            "boundaries/no-unknown-dependencies": "error",
            "boundaries/no-unknown-files": "error",
        },
    }),
);
