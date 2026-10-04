import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTypeScript,
  {
    ignores: [
      '.next/**',
      '.claude/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'dist/**',
      'out/**',
      'public/sw.js',
      'src/generated/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}', 'scripts/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['universal-parcel-scraper/*', '!universal-parcel-scraper/app', '!universal-parcel-scraper/node', '!universal-parcel-scraper/places', '!universal-parcel-scraper/data/*'],
          message: 'Use a published Universal Parcel Scraper entry point.',
        }],
      }],
    },
  },
];

export default config;
