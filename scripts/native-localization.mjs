export function nativeLocalizationReferences(swiftSource, localizationKeys) {
  // Accessibility identifiers are stable UI automation hooks, not display copy.
  // Only skip literal arguments so localization calls inside expressions are checked.
  const source = swiftSource.replace(
    /\.\s*accessibilityIdentifier\s*\(\s*"(?:\\.|[^"\\])*"\s*\)/g,
    '',
  );
  const prefixes = new Set(localizationKeys.map((key) => key.split('.')[0]));
  return new Set(
    [...source.matchAll(/"([a-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)"/g)]
      .map((match) => match[1])
      .filter((key) => prefixes.has(key.split('.')[0])),
  );
}
