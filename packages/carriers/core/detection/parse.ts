/**
 * Pasted-input parsing.
 *
 * What it is: turns whatever a user pastes — a bare number, a carrier link, or
 * a whole shipping message — into a tracking number plus a carrier, using the
 * catalog link rules and then the detection engine.
 * What it is not: it never fetches the pasted URL and performs no provider I/O;
 * every decision comes from the string and the catalog.
 */
import { TRACKING_LINK_RULES, matchesDomain, type TrackingLinkRule } from '../catalog/linkRules';
import { keywordNumberInText, recognizedNumberInText } from './candidates';
import { detectCarrierMatch } from './detect';
import { validTrackingNumber } from './normalize';
import type { TrackingInputMatch } from './types';

function trimPastedUrl(raw: string): string {
  return raw.replace(/^[\s<'"(\x5b]+/, '').replace(/[\s>'")\],;.!?]+$/, '');
}

function cleanLinkTrackingNumber(raw: string): string {
  return raw.split(/[,|]/, 1)[0].trim();
}

function queryParam(url: URL, names: string[]): string | undefined {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [name, value] of url.searchParams) {
    if (wanted.has(name.toLowerCase()) && value.trim()) return value;
  }
  return undefined;
}

function numberFromRule(url: URL, rule: TrackingLinkRule): string | undefined {
  const fromQuery = rule.params ? queryParam(url, rule.params) : undefined;
  const fromPath = rule.path?.exec(url.pathname)?.[1];
  const fromFragment = rule.fragment?.exec(decodeURIComponent(url.hash.slice(1)))?.[1];
  const candidate = cleanLinkTrackingNumber(fromQuery ?? fromPath ?? fromFragment ?? '');
  return validTrackingNumber(candidate) ? candidate : undefined;
}

function trackingMatch(
  trackingNumber: string,
  source: TrackingInputMatch['source'],
): TrackingInputMatch {
  return { trackingNumber, source, ...detectCarrierMatch(trackingNumber) };
}

/**
 * Pull a tracking number and carrier out of a number, carrier URL, or pasted
 * shipping message. Number shape disambiguates links shared by multiple brands.
 */
export function parseTrackingInput(raw: string): TrackingInputMatch {
  const input = raw.trim();
  if (!input) {
    return {
      trackingNumber: '',
      carrier: 'unknown',
      confidence: 'none',
      candidates: [],
      source: 'none',
    };
  }

  const pastedUrls = input.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  for (const pastedUrl of pastedUrls) {
    const trackingUrl = trimPastedUrl(pastedUrl);
    try {
      const url = new URL(trackingUrl);
      const rules = TRACKING_LINK_RULES.filter((candidate) =>
        candidate.domains.some((domain) => matchesDomain(url.hostname.toLowerCase(), domain))
        && (!candidate.pathPattern || candidate.pathPattern.test(url.pathname)),
      );
      const specificity = (rule: TrackingLinkRule) => Math.max(...rule.domains.filter((domain) => matchesDomain(url.hostname.toLowerCase(), domain)).map((domain) => domain.length));
      rules.sort((a, b) => specificity(b) - specificity(a));
      for (const firstRule of rules) {
        const trackingNumber = numberFromRule(url, firstRule);
        if (trackingNumber) {
          const detected = detectCarrierMatch(trackingNumber);
          if (firstRule.detectFromNumber && detected.confidence === 'high') {
            return { trackingNumber, ...detected, source: 'link' };
          }
          const suggestedRules = rules.filter((candidate) => detected.candidates.includes(candidate.carrier));
          const suggestedCarriers = new Set(suggestedRules.map((candidate) => candidate.carrier));
          const rule = detected.confidence === 'high'
            ? rules.find((candidate) => candidate.carrier === detected.carrier) ?? firstRule
            : suggestedCarriers.size === 1 ? suggestedRules[0] : firstRule;
          return {
            trackingNumber,
            carrier: rule.carrier,
            confidence: 'high',
            candidates: [rule.carrier],
            trackingUrl: rule.keepsCapabilityUrl ? trackingUrl : undefined,
            source: 'link',
          };
        }
      }

      const trackingNumber = recognizedNumberInText(decodeURIComponent(url.href));
      if (trackingNumber) return trackingMatch(trackingNumber, 'link');
    } catch {
      // Keep looking: pasted prose can contain a truncated or malformed URL.
    }
  }

  const recognized = recognizedNumberInText(input);
  if (recognized) {
    return trackingMatch(recognized, input === recognized ? 'number' : 'text');
  }

  const keywordNumber = keywordNumberInText(input);
  if (keywordNumber) return trackingMatch(keywordNumber, 'text');

  if (!input.includes('://') && validTrackingNumber(input)) {
    return trackingMatch(input, 'number');
  }

  return {
    trackingNumber: '',
    carrier: 'unknown',
    confidence: 'none',
    candidates: [],
    source: 'none',
  };
}
