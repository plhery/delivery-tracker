import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { InvitationParcelArtwork } from './InvitationParcel';

it.each([
  ['Paul', 'P'], ['alice', 'A'], ['Mila', 'M'], ['E\u0301milie', 'É'], ['  Zoë ', 'Z'],
])('personalizes the parcel seal and card for %s', (nickname, initial) => {
  const { container } = render(<InvitationParcelArtwork nickname={nickname} />);
  expect(container.querySelector('.parcel-illustration__initial')).toHaveAttribute('data-initial', initial);
  expect(container.querySelector('.parcel-illustration__delivery-card text')).toHaveTextContent(initial);
});

it('keeps the original geometric M and draws different initials in the same style', () => {
  const { container, rerender } = render(<InvitationParcelArtwork nickname="Mila" />);
  const mark = () => container.querySelector('.parcel-illustration__initial');
  const originalM = 'M-6 6V-6l6 7 6-7V6';
  expect(mark()).toHaveAttribute('d', originalM);
  expect(mark()).toHaveAttribute('stroke-width', '1.5');
  rerender(<InvitationParcelArtwork nickname="Paul" />);
  expect(mark()?.tagName).toBe('path');
  expect(mark()).not.toHaveAttribute('d', originalM);
  rerender(<InvitationParcelArtwork nickname="李" />);
  expect(mark()?.tagName).toBe('text');
  expect(mark()).toHaveTextContent('李');
});
