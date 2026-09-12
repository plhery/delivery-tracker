/**
 * GLS Germany status classification.
 *
 * Germany and Switzerland are served by the same GROUP recipient service, so
 * there is one map for both and it lives in the Swiss folder. This module
 * re-exports it so a reader of this folder finds the vocabulary where the
 * skeleton says it should be, without a second copy to keep in step.
 * The observed entries are listed in this folder's `statuses.json`.
 */
export {
  classifyDescription,
  GLS_STATUSES,
  glsSwitzerlandStatus as glsGermanyStatus,
  statusCode,
  type ClassifiedStatus,
} from '../gls-ch/status';
