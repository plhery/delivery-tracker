// Single-stroke capitals drawn on the original M's 12 × 12 grid.
const letters: Record<string, string> = {
  A: 'M-6 6 0-6 6 6M-3.5 1h7',
  B: 'M-5 6V-6h6l4 3-4 3h-6m6 0 4 3-4 3h-6',
  C: 'M5-6h-7l-3 3v6l3 3h7',
  D: 'M-5 6V-6h6l4 4v4l-4 4h-6',
  E: 'M5-6H-5V6H5M-5 0h8',
  F: 'M5-6H-5V6M-5 0h8',
  G: 'M5-6h-7l-3 3v6l3 3h7V0H1',
  H: 'M-5-6V6M5-6V6M-5 0H5',
  I: 'M-4-6h8M0-6V6M-4 6h8',
  J: 'M-3-6h8V3L2 6h-4l-3-3',
  K: 'M-5-6V6M5-6-5 2M-1-1 5 6',
  L: 'M-5-6V6H5',
  M: 'M-6 6V-6l6 7 6-7V6',
  N: 'M-5 6V-6L5 6V-6',
  O: 'M-2-6h4l3 3v6L2 6h-4l-3-3v-6l3-3Z',
  P: 'M-5 6V-6h7l3 3-3 3h-7',
  Q: 'M-2-6h4l3 3v6L2 6h-4l-3-3v-6l3-3ZM1 2l5 5',
  R: 'M-5 6V-6h7l3 3-3 3h-7m6 0 4 6',
  S: 'M5-6h-7l-3 3 3 3h4l3 3-3 3h-7',
  T: 'M-6-6H6M0-6V6',
  U: 'M-5-6V3l3 3h4l3-3V-6',
  V: 'M-6-6 0 6 6-6',
  W: 'M-6-6-3 6 0-1 3 6 6-6',
  X: 'M-5-6 5 6M5-6-5 6',
  Y: 'M-6-6 0 0 6-6M0 0v6',
  Z: 'M-5-6H5L-5 6H5',
};

const accents: Record<string, string> = {
  '\u0300': 'M-2-10 1-8',
  '\u0301': 'M-1-8 2-10',
  '\u0302': 'M-3-8 0-10 3-8',
  '\u0303': 'M-3-8-1-10 1-8 3-10',
  '\u0308': 'M-3-9v.2M3-9v.2',
  '\u030a': 'M-2-9a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  '\u030c': 'M-3-10 0-8 3-10',
  '\u0327': 'M0 6v2h2l-2 2h-2',
};

/** Unsupported characters keep their normal text glyph instead of changing initial. */
export function invitationInitialPath(initial: string): string | null {
  const [letter, ...marks] = Array.from(initial.normalize('NFD'));
  if (!letters[letter] || marks.some((mark) => !accents[mark])) return null;
  return [letters[letter], ...marks.map((mark) => accents[mark])].join('');
}
