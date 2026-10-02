import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ParcelIllustration } from '../../components/Icon';
import { carrierInfo } from '../../lib/carriers';
import { GiftNote, GiftSurprise } from './Gift';

describe('a gift’s drawings and words', () => {
  it('ties a ribbon around Pip, between his eyes, and puts a gift on the card inside', () => {
    const { container, rerender } = render(<ParcelIllustration ribbon />);
    const pip = container.querySelector('svg.parcel-illustration')!;
    expect(pip).toHaveAttribute('aria-hidden', 'true');
    const ribbon = pip.querySelector('.parcel-illustration__ribbon')!;
    expect(ribbon.querySelectorAll('path, ellipse')).toHaveLength(5);
    // The ribbon is drawn over the face and the tape, under the sparks.
    const order = [...pip.querySelectorAll('.parcel-illustration__pip, .parcel-illustration__tape, .parcel-illustration__ribbon, .parcel-illustration__glints')]
      .map((part) => part.getAttribute('class'));
    expect(order).toEqual(['parcel-illustration__pip', 'parcel-illustration__tape', 'parcel-illustration__ribbon', 'parcel-illustration__glints']);
    expect(pip.querySelector('.parcel-illustration__check')).toBeNull();
    // Without it, Pip is the parcel he always was; a label and a ribbon are separate choices.
    rerender(<ParcelIllustration />);
    expect(container.querySelector('.parcel-illustration__ribbon')).toBeNull();
    expect(container.querySelector('.parcel-illustration__check')).not.toBeNull();
    rerender(<ParcelIllustration label={{ carrier: carrierInfo('dhl'), number: '1234567899' }} />);
    expect(container.querySelector('.parcel-illustration__ribbon')).toBeNull();
    expect(container.querySelector('.parcel-illustration__label')).not.toBeNull();
  });

  it('says why a gift on its way tells so little', () => {
    render(<GiftSurprise />);
    expect(screen.getByText('What’s inside and who sent it stay a surprise until it’s delivered.')).toBeVisible();
  });

  it('shows the note, who it is from and what is inside, each only when the link carried it', () => {
    const { container, rerender } = render(<GiftNote note="Happy birthday, Alex!" from="Sam" inside="trail running shoes" />);
    expect(screen.getByText('Happy birthday, Alex!')).toBeVisible();
    expect(screen.getByText('— Sam')).toBeVisible();
    expect(screen.getByText('trail running shoes').parentElement).toHaveTextContent('Inside: trail running shoes');
    rerender(<GiftNote note={null} from={null} inside="trail running shoes" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    rerender(<GiftNote note="Just a note" from={null} inside={null} />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    rerender(<GiftNote note={null} from={null} inside={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
