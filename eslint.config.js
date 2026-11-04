import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

/**
 * Module boundaries, enforced with no-restricted-imports. Every src/ file matches exactly one block below,
 * because a later block's options for the rule replace an earlier one's.
 *
 *   src/*.ts                   the composition root (main.ts, composition.ts): imports modules only through their index.ts
 *   settings/, slack/          shared modules: import no other module
 *   <capability>/index.ts      a capability's public contract: re-exports its own layers only
 *   <capability>/domain/       pure rules: imports only its own domain, nothing from Devvit
 *   <capability>/application/  use cases and ports: imports its own domain, nothing from Devvit
 *   <capability>/infrastructure/ adapters: imports its own domain and application, slack's index and Devvit types
 *
 * Only main.ts registers with Devvit (imports `Devvit` itself); other files may import Devvit's types.
 */
const CAPABILITIES = ['moderation', 'modqueue', 'postDeletion'];

const devvitRegistration = {
  name: '@devvit/public-api',
  importNames: ['Devvit'],
  message: 'Only src/main.ts registers with Devvit; import Devvit types only.',
};

function boundary(files, patterns, { registersWithDevvit = false } = {}) {
  return {
    files,
    rules: {
      'no-restricted-imports': ['error', { paths: registersWithDevvit ? [] : [devvitRegistration], patterns }],
    },
  };
}

const capabilityFiles = (part) => CAPABILITIES.map((capability) => `src/${capability}/${part}`);

export default [
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  boundary(
    ['src/*.ts'],
    [{ regex: '^\\./[^/]+/', message: 'Import a module through its index.ts (e.g. "./moderation"), not its internals.' }],
  ),
  boundary(
    ['src/main.ts'],
    [{ regex: '^\\./[^/]+/', message: 'Import a module through its index.ts (e.g. "./moderation"), not its internals.' }],
    { registersWithDevvit: true },
  ),
  boundary(
    ['src/settings/**/*.ts', 'src/slack/**/*.ts'],
    [{ regex: '^\\.\\./', message: 'settings and slack are shared modules: they import no other module.' }],
  ),
  boundary(
    capabilityFiles('index.ts'),
    [{ regex: '^\\.\\./', message: "A capability's index.ts re-exports its own layers only." }],
  ),
  boundary(
    capabilityFiles('domain/**/*.ts'),
    [
      { regex: '^\\.\\./', message: 'The domain imports only its own domain files.' },
      { regex: '^@devvit/', message: 'The domain does not depend on Devvit.' },
    ],
  ),
  boundary(
    capabilityFiles('application/**/*.ts'),
    [
      {
        regex: '^\\.\\./(?!domain/)',
        message: 'The application layer imports its own domain and application files only; infrastructure implements its ports.',
      },
      { regex: '^@devvit/', message: 'The application layer does not depend on Devvit; declare a port instead.' },
    ],
  ),
  boundary(
    capabilityFiles('infrastructure/**/*.ts'),
    [
      {
        regex: '^\\.\\./(?!domain/|application/|\\.\\./slack$)',
        message:
          "Infrastructure imports its own domain and application files and slack's index.ts; capabilities do not import each other, settings or the composition root.",
      },
    ],
  ),

  {
    ignores: ['dist/', 'node_modules/'],
  },
];
