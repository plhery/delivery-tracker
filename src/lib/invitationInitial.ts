const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Keep accents and joined characters together when taking a sender's initial. */
export function invitationInitial(nickname: string | null): string {
  const name = nickname?.trim().normalize('NFC') ?? '';
  return graphemes.segment(name)[Symbol.iterator]().next().value?.segment.toUpperCase() ?? '';
}
