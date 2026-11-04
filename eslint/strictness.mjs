import { defineConfig } from "eslint/config";

/** @typescript-eslint/naming-convention selectors, shared with eslint/tests.mjs, which adds to them. */
export const NAMING_CONVENTION = [
    { selector: "default", format: ["camelCase"], leadingUnderscore: "allow", trailingUnderscore: "allow" },
    { selector: "import", format: ["camelCase", "PascalCase"] },
    {
        selector: "variable",
        format: ["camelCase", "UPPER_CASE"],
        leadingUnderscore: "allow",
        trailingUnderscore: "allow",
    },
    { selector: "typeLike", format: ["PascalCase"] },
    // Quoted keys are data (HTTP header names, ESLint rule names), not identifiers (per the rule's docs).
    {
        selector: ["objectLiteralProperty", "objectLiteralMethod"],
        modifiers: ["requiresQuotes"],
        format: null,
    },
    // SLACK_PAYLOAD_FIELDS: Slack's incoming-webhook payload names these fields in snake_case.
    {
        selector: ["typeProperty", "objectLiteralProperty"],
        filter: { regex: "^(?:icon_emoji|mrkdwn_in)$", match: true },
        format: null,
    },
];

// Rule options stricter than the presets' defaults, and the preset rules switched off, each for one stated reason.
export const strictness = defineConfig({
    rules: {
        // Core rules, stricter options.
        "eqeqeq": ["error", "always", { null: "ignore" }],
        "curly": ["error", "all"],
        // Slack's webhook payload fixes the names of two fields (see SLACK_PAYLOAD_FIELDS above).
        "camelcase": ["error", { properties: "always", allow: ["^icon_emoji$", "^mrkdwn_in$"] }],
        "arrow-body-style": ["error", "as-needed"],
        "func-style": ["error", "declaration", { allowArrowFunctions: true }],
        "object-shorthand": ["error", "always"],
        "operator-assignment": ["error", "always"],
        "logical-assignment-operators": ["error", "always", { enforceForIfStatements: true }],
        "no-else-return": ["error", { allowElseIf: false }],
        // verbatimModuleSyntax needs value and type imports from one module as separate statements.
        "no-duplicate-imports": ["error", { allowSeparateTypeImports: true, includeExports: true }],
        // Names this code chooses; property names are often fixed by an external API (Slack's and Devvit's payloads).
        "id-length": ["error", { properties: "never" }],

        // Rules from eslint.configs.all that are off, each for one stated reason.
        // Conflicts: switch-exhaustiveness-check forbids a default branch on an exhaustive union switch,
        // so adding a union member becomes a type error instead of falling into `default`.
        "default-case": "off",
        // Conflicts: noImplicitReturns requires writing `return undefined` explicitly.
        "no-undefined": "off",
        // Conflicts: consistent-return cannot see that an exhaustive switch returns on every path, and wants a return
        // after it that allowUnreachableCode: false forbids. noImplicitReturns, with every return type declared,
        // already guarantees each path returns a value, and understands exhaustive switches.
        "@typescript-eslint/consistent-return": "off",
        // Conflicts: import-x/order owns import ordering.
        "sort-imports": "off",
        // Conflicts: eqeqeq allows `== null` deliberately; it matches exactly null and undefined, and Devvit's
        // payloads and the app's stored records use both for an absent value.
        "no-eq-null": "off",
        // Conflicts: the WORKAROUND block format has fixed lowercase labels, and comments often begin with a
        // code identifier whose case is meaningful; the autofix rewrites both.
        "capitalized-comments": "off",
        // Duplicates: regexp/prefer-named-capture-group and regexp/require-unicode-regexp report the same thing.
        "prefer-named-capture-group": "off",
        "require-unicode-regexp": "off",
        // Platform: console is Devvit's logging channel (`devvit logs` streams it).
        "no-console": "off",
        // Taste, with an equally valid opposite and no correctness value: grouping declarations, ordering
        // object keys (schema keys follow the Config interface), and banning ternaries.
        "one-var": "off",
        "sort-keys": "off",
        "no-ternary": "off",
        // Platform: the `v` flag needs ES2024; Devvit's shared tsconfig and its esbuild bundle target ES2020.
        "regexp/require-unicode-sets-regexp": "off",

        // typescript-eslint, stricter options.
        "@typescript-eslint/strict-boolean-expressions": [
            "error",
            {
                allowAny: false,
                allowNullableBoolean: false,
                allowNullableEnum: false,
                allowNullableNumber: false,
                allowNullableObject: false,
                allowNullableString: false,
                allowNumber: false,
                allowString: false,
            },
        ],
        "@typescript-eslint/switch-exhaustiveness-check": [
            "error",
            {
                allowDefaultCaseForExhaustiveSwitch: false,
                considerDefaultExhaustiveForUnions: false,
                requireDefaultForNonUnion: true,
            },
        ],
        "@typescript-eslint/explicit-function-return-type": [
            "error",
            {
                allowConciseArrowFunctionExpressionsStartingWithVoid: false,
                allowDirectConstAssertionInArrowFunctions: false,
                allowExpressions: false,
                allowFunctionsWithoutTypeParameters: false,
                allowHigherOrderFunctions: false,
                allowIIFEs: false,
                allowTypedFunctionExpressions: false,
            },
        ],
        "@typescript-eslint/consistent-type-imports": [
            "error",
            {
                disallowTypeAnnotations: true,
                fixStyle: "separate-type-imports",
                prefer: "type-imports",
            },
        ],
        "@typescript-eslint/naming-convention": ["error", ...NAMING_CONVENTION],
        "@typescript-eslint/return-await": ["error", "always"],
        "@typescript-eslint/no-floating-promises": [
            "error",
            { checkThenables: true, ignoreIIFE: false, ignoreVoid: false },
        ],
        "@typescript-eslint/no-unnecessary-condition": [
            "error",
            { allowConstantLoopConditions: "never", checkTypePredicates: true },
        ],
        "@typescript-eslint/require-array-sort-compare": ["error", { ignoreStringArrays: false }],
        "@typescript-eslint/no-shadow": [
            "error",
            {
                builtinGlobals: true,
                hoist: "all",
                ignoreFunctionTypeParameterNameValueShadow: false,
                ignoreTypeValueShadow: false,
            },
        ],
        // -1, 0 and 1 are comparator results, offsets and emptiness checks, not domain values.
        "@typescript-eslint/no-magic-numbers": [
            "error",
            {
                detectObjects: true,
                enforceConst: true,
                ignore: [-1, 0, 1],
                ignoreArrayIndexes: false,
                ignoreEnums: false,
                ignoreNumericLiteralTypes: false,
                ignoreReadonlyClassProperties: false,
                ignoreTypeIndexes: false,
            },
        ],
        "@typescript-eslint/prefer-readonly-parameter-types": [
            "error",
            {
                // WORKAROUND: Date parameters count as readonly
                //   cause: Date is a mutable built-in (setHours and friends), so no Date parameter can be deeply
                //     readonly.
                //   blocked: the immutable replacement, Temporal, is not in Devvit's ES2020 runtime or its TypeScript
                //     lib.
                //   fix: carry instants as Temporal.Instant instead of Date.
                //   until: Devvit's runtime and tsconfig lib include Temporal.
                allow: [{ from: "lib", name: "Date" }],
                checkParameterProperties: true,
                ignoreInferredTypes: false,
                treatMethodsAsReadonly: false,
            },
        ],

        // Every suppression is a single next-line directive with a written reason.
        "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }],
        "@eslint-community/eslint-comments/no-unlimited-disable": "error",
        "@eslint-community/eslint-comments/no-use": ["error", { allow: ["eslint-disable-next-line"] }],

        // Imports. The first three are warnings in import-x's recommended config.
        "import-x/no-duplicates": "error",
        "import-x/no-named-as-default": "error",
        "import-x/no-named-as-default-member": "error",
        "import-x/no-extraneous-dependencies": [
            "error",
            {
                devDependencies: ["**/*.test.ts", "tests/**", "vitest.config.ts", "eslint.config.mjs", "eslint/**"],
                includeInternal: true,
                includeTypes: true,
            },
        ],
        "import-x/no-self-import": "error",
        "import-x/no-useless-path-segments": "error",
        "import-x/no-relative-packages": "error",
        "import-x/no-mutable-exports": "error",
        "import-x/no-named-default": "error",
        "import-x/no-empty-named-blocks": "error",
        "import-x/no-anonymous-default-export": "error",
        "import-x/no-default-export": "error",
        "import-x/consistent-type-specifier-style": ["error", "prefer-top-level"],
        "import-x/first": "error",
        "import-x/newline-after-import": "error",
        "import-x/order": ["error", { "alphabetize": { order: "asc" }, "newlines-between": "never" }],
    },
});
