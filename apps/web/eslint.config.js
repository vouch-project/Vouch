import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import path from 'path';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(
  {
    ignores: ['eslint.config.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      svelte: svelte,
    },
    rules: {
      // Enforce arrow functions only
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
      // Possible Errors (recommended)
      'svelte/infinite-reactive-loop': 'error',
      'svelte/no-dom-manipulating': 'error',
      'svelte/no-dupe-else-if-blocks': 'error',
      'svelte/no-dupe-on-directives': 'error',
      'svelte/no-dupe-style-properties': 'error',
      'svelte/no-dupe-use-directives': 'error',
      'svelte/no-not-function-handler': 'error',
      'svelte/no-object-in-text-mustaches': 'error',
      'svelte/no-raw-special-elements': 'error',
      'svelte/no-reactive-reassign': 'error',
      'svelte/no-shorthand-style-property-overrides': 'error',
      'svelte/no-store-async': 'error',
      'svelte/no-unknown-style-directive-property': 'error',
      'svelte/prefer-svelte-reactivity': 'warn',
      'svelte/require-store-reactive-access': 'error',
      'svelte/valid-compile': 'error',
      // Security
      'svelte/no-at-html-tags': 'error',
      // Best Practices
      'svelte/block-lang': ['warn', { script: ['ts'] }],
      'svelte/button-has-type': 'warn',
      'svelte/no-add-event-listener': 'warn',
      'svelte/no-at-debug-tags': 'warn',
      'svelte/no-immutable-reactive-statements': 'warn',
      'svelte/no-inspect': 'warn',
      'svelte/no-reactive-functions': 'warn',
      'svelte/no-reactive-literals': 'warn',
      'svelte/no-svelte-internal': 'warn',
      'svelte/no-unnecessary-state-wrap': 'warn',
      'svelte/no-unused-props': 'warn',
      'svelte/no-unused-svelte-ignore': 'warn',
      'svelte/no-useless-children-snippet': 'warn',
      'svelte/no-useless-mustaches': 'warn',
      'svelte/prefer-const': 'warn',
      'svelte/prefer-destructured-store-props': 'warn',
      'svelte/prefer-writable-derived': 'warn',
      'svelte/require-each-key': 'error',
      'svelte/require-event-dispatcher-types': 'warn',
      'svelte/require-stores-init': 'warn',
      'svelte/valid-each-key': 'error',
      // Stylistic Issues
      'svelte/consistent-selector-style': 'warn',
      'svelte/html-closing-bracket-new-line': 'warn',
      'svelte/html-closing-bracket-spacing': 'warn',
      'svelte/html-quotes': 'warn',
      'svelte/html-self-closing': 'warn',
      'svelte/mustache-spacing': 'warn',
      'svelte/no-extra-reactive-curlies': 'warn',
      'svelte/no-spaces-around-equal-signs-in-attribute': 'warn',
      'svelte/prefer-class-directive': 'warn',
      'svelte/prefer-style-directive': 'warn',
      'svelte/require-event-prefix': 'warn',
      'svelte/shorthand-attribute': 'warn',
      'svelte/shorthand-directive': 'warn',
      'svelte/sort-attributes': 'warn',
      'svelte/spaced-html-comment': 'warn',
      // Extension Rules
      'svelte/no-inner-declarations': 'error',
      'svelte/no-trailing-spaces': 'warn',
      // SvelteKit
      'svelte/no-export-load-in-svelte-module-in-kit-pages': 'error',
      'svelte/no-navigation-without-resolve': 'error',
      'svelte/valid-prop-names-in-kit-pages': 'error',
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    ignores: ['build/', '.svelte-kit/', 'dist/'],
  },
);
