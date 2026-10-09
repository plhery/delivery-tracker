'use client';

import { useRef, type FormEvent, type KeyboardEvent } from 'react';
import { writeCarrierHandoff } from '../lib/carrierHandoff';
import { LANDING_PATH } from '../lib/experience';
import { languagePath, type Locale } from '../lib/locale';
import { CarrierSwatch } from './CarrierIndex';

/**
 * The tracker on a carrier's page: what is typed here is looked up on the
 * landing in the page's language, at the landing's own address (at `/`,
 * someone signed in sees their deliveries). What is typed never goes into an
 * address: the field has no name, so without a script the form opens the
 * landing alone; with one, the text waits for the landing in this tab's
 * session storage.
 */
export function CarrierTracker({ locale, color, label, placeholder, action, note }: {
  locale: Locale;
  /** The carrier's colour, beside its name. */
  color: string;
  label: string;
  placeholder: string;
  action: string;
  /** That Peek is not the carrier, under the field. */
  note: string;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const landing = locale === 'en' ? LANDING_PATH : languagePath(locale);

  function track(event: FormEvent) {
    event.preventDefault();
    const text = field.current?.value.trim();
    if (!text) {
      field.current?.focus();
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

  return <form className="carrier-tracker" action={landing} method="get" noValidate onSubmit={track}>
    <label className="field__label" htmlFor="carrier-tracking"><CarrierSwatch color={color} />{label}</label>
    <div className="carrier-tracker__row">
      {/* A message pasted whole keeps its lines, as in the landing's own field. */}
      <textarea ref={field} id="carrier-tracking" className="field__input" rows={1} placeholder={placeholder}
        autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go"
        aria-describedby="carrier-tracking-note" onKeyDown={onKeyDown} />
      <button className="button button--primary" type="submit">{action}</button>
    </div>
    <p className="carrier-tracker__note" id="carrier-tracking-note">{note}</p>
  </form>;
}
