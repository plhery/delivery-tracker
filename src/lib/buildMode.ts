/** Whether a build keeps its parcels in the browser (the demo) instead of asking the API. */
export function shouldUseDemoRepository(
  nodeEnvironment: string | undefined,
  apiSetting: string | undefined,
): boolean {
  const normalizedSetting = apiSetting?.trim().toLowerCase();
  if (normalizedSetting === 'true') return false;
  if (normalizedSetting === 'false') return true;
  return nodeEnvironment === 'development';
}

/** Decided once, when the bundle is built. */
export const isDemoBuild = shouldUseDemoRepository(
  process.env.NODE_ENV,
  process.env.NEXT_PUBLIC_USE_API,
);
