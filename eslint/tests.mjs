import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import { NAMING_CONVENTION } from "./strictness.mjs";

// vitest.configs.all sets every rule to "warn"; here every vitest rule is an error.
/** @type {Record<string, "error">} */
const vitestRulesAsErrors = {};
for (const rule of Object.keys(vitest.configs.all.rules)) {
    vitestRulesAsErrors[rule] = "error";
}

export const tests = defineConfig(
    {
        // Fakes implement Devvit's client methods with Devvit's own signatures, such as
        // RedisClient.zRange(key, start, stop, options), which take more parameters than max-params allows.
        files: ["tests/support/fake*.ts"],
        rules: {
            "@typescript-eslint/max-params": "off",
        },
    },
    {
        files: ["**/*.test.ts"],
        plugins: { vitest },
        settings: {
            vitest: {
                // Lets rules such as valid-title use type information (e.g. to accept describe(someFunction, ...)).
                typecheck: true,
            },
        },
        rules: {
            ...vitestRulesAsErrors,
            // Conflicts: prefer-strict-boolean-matchers requires toBe(true) / toBe(false), which also rejects truthy
            // non-booleans; these two require toBeTruthy() / toBeFalsy().
            "vitest/prefer-to-be-falsy": "off",
            "vitest/prefer-to-be-truthy": "off",
            // Conflicts: prefer-importing-vitest-globals is on; tests import from "vitest" explicitly.
            "vitest/no-importing-vitest-globals": "off",
            // Replaced in tests by vitest/unbound-method, which understands expect(mock.method) (per @vitest/eslint-plugin
            // docs).
            "@typescript-eslint/unbound-method": "off",
            // Literal expected values are the content of a test; naming each one hides what is asserted.
            "@typescript-eslint/no-magic-numbers": "off",
            // Conflicts: require-top-level-describe puts every test of a file inside one describe callback.
            "max-lines-per-function": "off",
            "max-statements": "off",
            // Tests replay trigger events one at a time, as Devvit delivers them: each must finish before the next starts.
            "no-await-in-loop": "off",
            // Conflicts: tests mock @devvit/public-api with a fake Devvit (tests/support/fakeDevvit.ts) implementing only
            // the registration API the app calls; vi.mock(import(...)) requires the factory to return the module's type.
            "vitest/prefer-import-in-mock": "off",
            "@typescript-eslint/naming-convention": [
                "error",
                ...NAMING_CONVENTION,
                // A module mock's keys are the mocked module's export names (`Devvit`).
                {
                    selector: ["typeProperty", "objectLiteralProperty"],
                    filter: { regex: "^Devvit$", match: true },
                    format: null,
                },
            ],
        },
    },
);
