import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTypeScript,
  {
    ignores: [
      '.next/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'dist/**',
      'out/**',
      'public/sw.js',
      'src/generated/**',
      'packages/carriers/generated/**',
    ],
  },
  {
    // The carrier package must stay extractable: it may not import the web
    // application, its framework, or its backing services. The host supplies
    // HTTP, sessions and telemetry through interfaces in core/.
    files: ['packages/carriers/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['next', 'next/*'], message: 'The carrier package must not depend on Next.js.' },
          { group: ['@supabase/*'], message: 'The carrier package must not talk to the database directly.' },
          { group: ['@sentry/*'], message: 'Report through the StepRecorder / telemetry interfaces instead.' },
          { group: ['@/*', '**/src/**', '**/app/**'], message: 'The carrier package must not import application code.' },
        ],
      }],
    },
  },
];

export default config;
