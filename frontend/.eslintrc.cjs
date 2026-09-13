/**
 * ESLint config for the React + Vite frontend.
 *
 * `npm run lint` existed in package.json but there was no config file, so the
 * script (and any CI lint step) failed immediately with
 * "No ESLint configuration found".
 */
module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'node_modules', 'coverage'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // The codebase uses `any` for API payloads in many places; flag it as a
    // warning so lint stays green while still surfacing new occurrences.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-empty': ['error', { allowEmptyCatch: true }],
    // vite.config.ts carries a documented `@ts-ignore` for a preview-host
    // workaround; allow suppression comments that explain themselves.
    '@typescript-eslint/ban-ts-comment': [
      'error',
      { 'ts-ignore': 'allow-with-description', 'ts-expect-error': 'allow-with-description' },
    ],
  },
};
