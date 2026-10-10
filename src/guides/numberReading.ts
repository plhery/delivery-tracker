import type { CarrierId } from 'universal-parcel-scraper';
import { carrierInfo } from '../lib/carriers';
import { checkDigitTrouble, readText, type CheckDigitTrouble } from '../peek/lookup/reading';

/** A carrier a number's shape points to, by its id in the scraper's catalog. */
export interface ShapeCarrier { id: string; name: string; color: string | null }

/** One number read out of the text, and whose its shape says it is. */
export interface CheckedNumber {
  number: string;
  /** The one carrier the shape proves, or the ones it fits. */
  carriers: ShapeCarrier[];
  certain: boolean;
  /** A postal number whose check digit does not add up. */
  typo: CheckDigitTrouble | null;
}

/** What the guide's checker shows for a text: its numbers, or that it is an order number instead. */
export interface NumberCheck { numbers: CheckedNumber[]; order: boolean }

const named = (id: CarrierId): ShapeCarrier => {
  const info = carrierInfo(id);
  return { id, name: info?.name ?? id, color: info?.color ?? null };
};

/**
 * Reads a text as the landing's field does, a number, a link or a whole message, and says of each number
 * which carrier its shape belongs to. Nothing is looked up: this is the shape alone.
 */
export function checkNumber(text: string): NumberCheck {
  const reading = readText(text);
  const matches = reading.numbers.length ? reading.numbers.map(({ match }) => match) : reading.match.trackingNumber ? [reading.match] : [];
  return {
    order: reading.order,
    numbers: matches.map((match) => {
      const certain = match.confidence === 'high' && match.carrier !== 'unknown';
      return {
        number: match.trackingNumber,
        carriers: (certain ? [match.carrier] : match.candidates).map(named),
        certain,
        typo: checkDigitTrouble(match.trackingNumber),
      };
    }),
  };
}
