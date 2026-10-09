import { watchBrowserErrors } from './src/lib/errorReports';

// Runs before the app renders, so an error its first render throws is reported too.
if (process.env.NODE_ENV === 'production') watchBrowserErrors();
