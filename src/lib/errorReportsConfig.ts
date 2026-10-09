/** The name of the meta tag in which the root layout tells the page where its errors go. */
export const ERROR_REPORTS_META = 'error-reports';

/** What the meta tag holds when this site reports the errors of its pages. */
export interface ErrorReportsConfig {
  dsn: string;
  release?: string;
  environment: string;
}
