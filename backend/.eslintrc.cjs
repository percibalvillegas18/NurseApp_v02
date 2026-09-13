/**
 * ESLint config for the NestJS backend.
 *
 * `npm run lint` existed in package.json but there was no config file (and the
 * typescript-eslint packages were not installed), so linting never ran.
 */
module.exports = {
  root: true,
  env: { node: true, es2021: true, jest: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'coverage',
    '.eslintrc.cjs',
    // The standalone demo API server is plain CommonJS with its own style.
    'mock-server.js',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    // Prisma payloads and the demo-mode mocks are loosely typed today; keep
    // `any` visible as a warning rather than a hard failure.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-empty': ['error', { allowEmptyCatch: true }],
    // Prisma's $on('query') listener is only typed when `log` is configured,
    // so it is suppressed with a documented @ts-expect-error.
    '@typescript-eslint/ban-ts-comment': [
      'error',
      { 'ts-ignore': 'allow-with-description', 'ts-expect-error': 'allow-with-description' },
    ],
    // Test doubles in *.spec.ts legitimately alias `this` when building mocks.
    '@typescript-eslint/no-this-alias': ['error', { allowDestructuring: true }],
  },
};
