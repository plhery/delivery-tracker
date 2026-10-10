'use client';

import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { CarrierSwatch } from '../carriers/CarrierIndex';
import { carrierPath } from '../carriers/paths';
import { CARRIER_LINKS } from '../generated/carriers';
import { carrierHandoffLanding, writeCarrierHandoff } from '../lib/carrierHandoff';
import type { Locale } from '../lib/locale';
import type { CheckedNumber, NumberCheck, ShapeCarrier } from './numberReading';

/** What the checker says, in the page's language. */
export interface CheckerWords {
  label: string;
  placeholder: string;
  action: string;
  /** Under the empty field: what it does. */
  hint: string;
  /** Before the one carrier a number's shape proves. */
  certain: string;
  /** Before the carriers a number's shape fits without proving one. */
  maybe: string;
  maybeNote: string;
  none: string;
  typo: string;
  /** Holds `{{number}}`. */
  suggest: string;
  orderTitle: string;
  orderBody: string;
}

type Reader = typeof import('./numberReading');
// The carrier data is large and the page is read without it: it is fetched once, when the reader starts typing.
let reader: Promise<Reader> | null = null;
const loadReader = () => (reader ??= import('./numberReading'));

/**
 * A field in a guide that names the carrier of a number as it is typed, from its shape alone, as the landing
 * reads it. Tracking it hands it to the landing the way a carrier's page does: never through an address.
 */
export function NumberChecker({ locale, words }: { locale: Locale; words: CheckerWords }) {
  const [text, setText] = useState('');
  const [check, setCheck] = useState<NumberCheck | null>(null);
  const landing = carrierHandoffLanding(locale);
  const shown = text.trim() ? check : null;

  useEffect(() => {
    if (!text.trim()) return;
    let current = true;
    loadReader().then(({ checkNumber }) => { if (current) setCheck(checkNumber(text)); }, () => undefined);
    return () => { current = false; };
  }, [text]);

  function track(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      document.getElementById('number-checker')?.focus();
      return;
    }
    writeCarrierHandoff(text);
    window.location.assign(landing);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter tracks, as on the landing; a new line in a pasted message takes Shift.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return <form className="carrier-tracker number-checker" action={landing} method="get" noValidate onSubmit={track}>
    <label className="field__label" htmlFor="number-checker">{words.label}</label>
    <div className="carrier-tracker__row">
      <textarea id="number-checker" className="field__input" rows={1} placeholder={words.placeholder} value={text}
        autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go"
        aria-describedby="number-checker-result" onChange={(event) => setText(event.target.value)} onFocus={() => void loadReader().catch(() => undefined)}
        onKeyDown={onKeyDown} />
      <button className="button button--primary" type="submit">{words.action}</button>
    </div>
    <div className="number-checker__result" id="number-checker-result" aria-live="polite">
      {!shown ? <p className="carrier-tracker__note">{words.hint}</p>
        : shown.order ? <p><strong>{words.orderTitle}</strong> {words.orderBody}</p>
          : !shown.numbers.length ? <p>{words.none}</p>
            : <ul>{shown.numbers.map((number) => <li key={number.number}><Verdict number={number} locale={locale} words={words} /></li>)}</ul>}
    </div>
  </form>;
}

function Verdict({ number, locale, words }: { number: CheckedNumber; locale: Locale; words: CheckerWords }) {
  const [before, after] = words.suggest.split('{{number}}');
  return <>
    <code>{number.number}</code>
    {number.typo ? <p>{words.typo}{number.typo.suggestion && <> {before}<code>{number.typo.suggestion}</code>{after}</>}</p>
      : !number.carriers.length ? <p>{words.none}</p>
        : <>
          <p className="number-checker__carriers">
            <span>{number.certain ? words.certain : words.maybe}</span>
            {number.carriers.map((carrier) => <Carrier key={carrier.id} carrier={carrier} locale={locale} />)}
          </p>
          {!number.certain && <p className="carrier-tracker__note">{words.maybeNote}</p>}
        </>}
  </>;
}

/** A carrier by its colour, leading to its page where the guide's language has one. */
function Carrier({ carrier, locale }: { carrier: ShapeCarrier; locale: Locale }) {
  const page = CARRIER_LINKS[locale].find((link) => link.catalog === carrier.id);
  const name = <><CarrierSwatch color={page?.color ?? carrier.color ?? 'transparent'} />{page?.name ?? carrier.name}</>;
  return page ? <a className="number-checker__carrier" href={carrierPath(locale, page.slug)}>{name}</a>
    : <span className="number-checker__carrier">{name}</span>;
}
