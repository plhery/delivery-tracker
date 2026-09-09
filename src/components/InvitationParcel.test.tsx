import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { InvitationParcelArtwork } from './InvitationParcel';

it.each([
  ['Paul', 'P'], ['alice', 'A'], ['Mila', 'M'], ['E\u0301milie', 'É'], ['  Zoë ', 'Z'],
])('personalizes the parcel seal and card for %s', (nickname, initial) => {
  const { container } = render(<InvitationParcelArtwork nickname={nickname} />);
  expect(container.querySelector('.parcel-illustration__initial')).toHaveTextContent(initial);
  expect(container.querySelector('.parcel-illustration__delivery-card text')).toHaveTextContent(initial);
});
