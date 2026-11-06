import eslint from "@eslint/js";
import { recommended as eslintCommentsRecommended } from "@eslint-community/eslint-plugin-eslint-comments/configs";
import { defineConfig } from "eslint/config";
import prettierCompatible from "eslint-config-prettier/flat";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { importX } from "eslint-plugin-import-x";
import { configs as regexpConfigs } from "eslint-plugin-regexp";
import { configs as typescriptEslintConfigs } from "typescript-eslint";
import { architecture } from "./eslint/architecture.mjs";
import { NAMING_CONVENTION, strictness } from "./eslint/strictness.mjs";
import { tests } from "./eslint/tests.mjs";

export default defineConfig(
    {
        // coverage/ is vitest's generated HTML report.
        ignores: ["**/node_modules", "**/dist", "**/coverage"],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: "error",
            reportUnusedInlineConfigs: "error",
        },
    },

    // Every rule from each source, then the typed presets on top so their stricter options win.
    eslint.configs.all,
    typescriptEslintConfigs.all,
    typescriptEslintConfigs.strictTypeChecked,
    typescriptEslintConfigs.stylisticTypeChecked,
    importX.flatConfigs.recommended,
    importX.flatConfigs.typescript,
    regexpConfigs.all,
    eslintCommentsRecommended,

    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    // The ESLint config runs on Node rather than in Devvit, so it is typed by tsconfig.node.json.
                    allowDefaultProject: ["eslint.config.mjs", "eslint/*.mjs"],
                    defaultProject: "tsconfig.node.json",
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        settings: {
            "import-x/resolver-next": [createTypeScriptImportResolver()],
        },
    },

    // This project's rule options, by concern.
    strictness,
    architecture,
    tests,

    {
        // Devvit loads the module named by `blocks.entry` in devvit.json through its default export.
        files: ["src/main.ts"],
        rules: {
            "import-x/no-default-export": "off",
        },
    },
    {
        // ESLint and Vitest load their config files through the default export.
        files: ["eslint.config.mjs", "vitest.config.ts", "vitest.load.config.ts"],
        rules: {
            "import-x/no-default-export": "off",
        },
    },
    {
        files: ["vitest.config.ts", "vitest.load.config.ts"],
        rules: {
            "@typescript-eslint/naming-convention": [
                "error",
                ...NAMING_CONVENTION,
                // Environment variable names (`TZ`) are UPPER_CASE by convention.
                { selector: "objectLiteralProperty", format: ["camelCase", "UPPER_CASE"] },
            ],
        },
    },

    // Prettier owns formatting (npm run format); this turns off every rule that would disagree with its output.
    prettierCompatible,
    {
        rules: {
            // eslint-config-prettier switches off two "special rules" that stay compatible with Prettier as used here:
            // curly "all" never conflicts (only its "multi-line" and "multi-or-nest" options do), and
            // no-unexpected-multiline catches automatic-semicolon-insertion hazards.
            "curly": ["error", "all"],
            "no-unexpected-multiline": "error",
        },
    },
);
