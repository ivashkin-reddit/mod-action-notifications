import path from "node:path";
import { defineConfig } from "eslint/config";
import { createConfig } from "eslint-plugin-boundaries/config";

// Architecture, as AGENTS.md ("Architecture") describes it, enforced by eslint-plugin-boundaries: every file under
// src and tests belongs to an element, and an import between elements is an error unless a policy below allows it.
// Policies are evaluated in order and the last one that matches decides.

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
    { type: "tests", pattern: "tests", partialMatch: false },
];

const SAME_MODULE = { module: "{{from.element.captured.module}}" };
const INTERFACE = "index.ts";
const PRODUCTION = ["domain", "application", "infrastructure", "module", "edge"];

/** @type {import("eslint-plugin-boundaries").DependenciesPolicy[]} */
const policies = [
    // Libraries are open to every file; Devvit is restricted below.
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
        disallow: { to: { module: { source: "@devvit/*" } } },
        message: "Domain and application code do not depend on Devvit; an adapter does, behind a port.",
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
    // The composition root: any module's interface, and the rest of the root.
    {
        from: { element: { type: "edge" } },
        allow: { to: [{ element: { type: "module", fileInternalPath: INTERFACE } }, { element: { type: "edge" } }] },
    },

    // Production code never imports a test or test support...
    {
        disallow: { to: { element: { type: "tests" } } },
        message: "Production code may not import a test or test support ({{dependency.source}}).",
    },
    // ...while tests reach the app only through what main.ts registers, plus test support, devvit.json and libraries.
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
];

const ARCHITECTURE_FILES = ["src/**/*.ts", "tests/**/*.ts"];

export const architecture = defineConfig(
    {
        files: ARCHITECTURE_FILES,
        rules: {
            // The policies keep imports between modules and layers one-way; this also covers files within a layer.
            "import-x/no-cycle": "error",
        },
        // eslint-plugin-boundaries resolves imports through eslint-module-utils, which reads this legacy setting.
        settings: { "import/resolver": { typescript: true } },
    },
    // createConfig registers the plugin, and accepts only its own settings and rules.
    createConfig({
        files: ARCHITECTURE_FILES,
        settings: {
            "boundaries/root-path": path.resolve(import.meta.dirname, ".."),
            "boundaries/elements": ELEMENTS,
            // devvit.json, which a test checks against what the app registers.
            "boundaries/files": [{ pattern: "devvit.json", category: "devvit-config" }],
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
