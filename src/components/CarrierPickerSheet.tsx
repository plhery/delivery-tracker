import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { carrierInfo, SELECTABLE_CARRIERS, type CarrierInfo } from '../lib/carriers';
import {
  alphabetSections,
  countryLine,
  searchCarriers,
  type CarrierSearchResult,
} from '../lib/carrierPicker';
import { useSheetDialog } from '../lib/modal';
import { countryName } from 'universal-parcel-scraper/app';
import type { CarrierId } from '../types';
import { CarrierTruck } from './CarrierMark';
import { Icon } from './Icon';
import './CarrierPickerSheet.css';

export interface CarrierPickerSection {
  key: string;
  title: string;
  carriers: readonly CarrierId[];
}

export interface CarrierPickerTag {
  label: string;
  tone: 'quiet' | 'found';
}

type Choice = CarrierId | 'auto';

interface Option {
  id: string;
  choice: Choice;
  carrier?: CarrierInfo;
  result?: CarrierSearchResult;
}

/** The name with the searched text marked, when the name itself matched. */
function highlighted(name: string, range?: readonly [number, number]): ReactNode {
  if (!range) return name;
  const characters = Array.from(name);
  return <>
    {characters.slice(0, range[0]).join('')}
    <mark>{characters.slice(range[0], range[1]).join('')}</mark>
    {characters.slice(range[1]).join('')}
  </>;
}

/**
 * Choose one of the catalog's carriers: automatic detection first when it is
 * offered, then the sections the caller passes (the carriers that fit the
 * number, the ones used before), then every carrier from A to Z. Typing
 * searches names, other names and countries.
 *
 * The sections keep the order they opened with: an answer that arrives while
 * the sheet is open only changes tags and the automatic row's text, so nothing
 * moves under the reader's finger.
 */
export function CarrierPickerSheet({
  selected,
  auto,
  sections,
  tags = {},
  onSelect,
  onClose,
}: {
  selected: Choice;
  /** Offers automatic detection, described by what the carrier check knows so far. */
  auto?: { description: string; recommended: boolean; busy: boolean };
  sections: readonly CarrierPickerSection[];
  tags?: Partial<Record<CarrierId, CarrierPickerTag>>;
  onSelect: (choice: Choice) => void;
  onClose: () => void;
}) {
  const { locale, languageTag, t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [openingSections] = useState(sections);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  // The letter under a finger held on the rail, and where its bubble sits.
  const [scrub, setScrub] = useState<{ letter: string; y: number } | null>(null);
  const scrubbing = useRef<string | null>(null);
  const scrollToActive = useRef(false);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const listId = `${baseId}-list`;
  // A touch keyboard would cover the list, so only a pointer device starts in the search field.
  const [startInSearch] = useState(() => window.matchMedia?.('(pointer: fine)').matches ?? true);
  const [dialog, close] = useSheetDialog<HTMLDivElement>(true, onClose, startInSearch ? search : undefined);

  const carriers = useMemo(
    () => SELECTABLE_CARRIERS.map((carrier) => carrierInfo(carrier.id, locale)),
    [locale],
  );
  // Countries are shown in the reader's language and searched in theirs and in English.
  const countryNameLists = useMemo(() => new Map(
    [...new Set(carriers.flatMap((carrier) => carrier.countries))].map((code) =>
      [code, [...new Set([countryName(code, languageTag), countryName(code, 'en')])]]),
  ), [carriers, languageTag]);
  const countryNames = useMemo(
    () => (code: string): readonly string[] => countryNameLists.get(code) ?? [countryName(code, languageTag)],
    [countryNameLists, languageTag],
  );
  const subtitle = (carrier: CarrierInfo) => countryLine(carrier.countries, (code) => countryNames(code)[0]);

  const trimmed = query.trim();
  const results = useMemo(() => trimmed ? searchCarriers(trimmed, carriers, {
    languageTag,
    countryNames,
    preferred: new Set(openingSections[0]?.carriers ?? []),
  }) : null, [trimmed, carriers, languageTag, countryNames, openingSections]);
  const letters = useMemo(() => alphabetSections(carriers, languageTag), [carriers, languageTag]);

  const option = (key: string, carrier: CarrierInfo, result?: CarrierSearchResult): Option => ({
    id: `${baseId}-${key}-${carrier.id}`, choice: carrier.id, carrier, result,
  });
  const browsing = openingSections.map((section) => ({
    ...section,
    options: section.carriers.map((id) => option(section.key, carrierInfo(id, locale))),
  }));
  const alphabet = letters.map((section) => ({
    ...section,
    options: section.carriers.map((carrier) => option('all', carrier)),
  }));
  const autoOption: Option | null = auto ? { id: `${baseId}-auto`, choice: 'auto' } : null;
  const options: Option[] = results
    ? results.map((result) => option('result', result.carrier, result))
    : [...(autoOption ? [autoOption] : []), ...browsing.flatMap((section) => section.options), ...alphabet.flatMap((section) => section.options)];
  const activeOption = options[Math.min(active, options.length - 1)];

  const activeId = activeOption?.id;
  useEffect(() => {
    if (!scrollToActive.current || !activeId) return;
    scrollToActive.current = false;
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  function move(step: number) {
    scrollToActive.current = true;
    setActive((current) => Math.max(0, Math.min(options.length - 1, Math.min(current, options.length - 1) + step)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter' && activeOption) { event.preventDefault(); onSelect(activeOption.choice); }
  }

  function changeQuery(value: string) {
    setQuery(value);
    setActive(0);
    list.current?.scrollTo?.({ top: 0 });
  }

  function jump(letter: string) {
    list.current?.querySelector(`[data-letter="${CSS.escape(letter)}"]`)?.scrollIntoView?.({ block: 'start' });
  }

  /**
   * The rail answers the finger, not the release: pressing a letter jumps to
   * it, and sliding jumps to each letter it crosses. Past either end the first
   * or last letter holds, as in the iPhone's section index.
   */
  function scrubTo(clientY: number) {
    const buttons = Array.from(rail.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    let nearest: HTMLButtonElement | undefined;
    let distance = Infinity;
    for (const button of buttons) {
      const { top, bottom } = button.getBoundingClientRect();
      const gap = clientY < top ? top - clientY : clientY > bottom ? clientY - bottom : 0;
      if (gap < distance) { distance = gap; nearest = button; }
    }
    const letter = nearest?.dataset.letter;
    if (!nearest || !letter || letter === scrubbing.current) return;
    scrubbing.current = letter;
    setScrub({ letter, y: nearest.offsetTop + nearest.offsetHeight / 2 });
    jump(letter);
  }

  function startScrub(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // No text selection, focus change or page scroll while the finger is down.
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrubbing.current = null;
    scrubTo(event.clientY);
  }

  function endScrub() {
    scrubbing.current = null;
    setScrub(null);
  }

  const renderOption = (item: Option) => {
    const index = options.indexOf(item);
    const isSelected = item.choice === selected;
    const className = `carrier-picker__option${index === active ? ' is-active' : ''}`;
    if (!item.carrier) {
      return <div key={item.id} id={item.id} role="option" aria-selected={isSelected} className={`${className} carrier-picker__option--auto`}
        onClick={() => onSelect('auto')} onPointerMove={() => setActive(index)}>
        <span className={`carrier-picker__detect${auto?.busy ? ' is-busy' : ''}`}><Icon name="detect" /></span>
        <span className="carrier-picker__text">
          <span className="carrier-picker__name">{t('add.detect')}</span>
          <span className="carrier-picker__sub">
            {auto?.recommended && <><span className="carrier-picker__tag carrier-picker__tag--quiet">{t('picker.recommended')}</span>{' '}</>}
            {auto?.description}
          </span>
        </span>
        {isSelected && <Icon name="check" className="carrier-picker__check" />}
      </div>;
    }
    const tag = tags[item.carrier.id];
    const sub = item.result?.alias ? t('picker.alias', { name: item.result.alias }) : subtitle(item.carrier);
    return <div key={item.id} id={item.id} role="option" aria-selected={isSelected} className={className}
      aria-labelledby={`${item.id}-name`} aria-describedby={sub || tag ? `${item.id}-more` : undefined}
      onClick={() => onSelect(item.carrier!.id)} onPointerMove={() => setActive(index)}>
      <CarrierTruck carrier={item.carrier} />
      <span className="carrier-picker__text">
        <span id={`${item.id}-name`} className="carrier-picker__name">{highlighted(item.carrier.name, item.result?.highlight)}</span>
        {sub && <span className="carrier-picker__sub">{sub}</span>}
      </span>
      {(sub || tag) && <span id={`${item.id}-more`} hidden>{[sub, tag?.label].filter(Boolean).join(', ')}</span>}
      {tag && <span className={`carrier-picker__tag carrier-picker__tag--${tag.tone}`} aria-hidden="true">{tag.label}</span>}
      {isSelected && <Icon name="check" className="carrier-picker__check" />}
    </div>;
  };

  return createPortal(
    <div className="sheet-backdrop carrier-picker-backdrop" onClick={close}>
      <div
        ref={dialog}
        className="sheet carrier-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="carrier-picker__heading">
          <button type="button" className="carrier-picker__cancel" onClick={close}>{t('common.cancel')}</button>
          <h2 className="carrier-picker__title" id={titleId}>{t('add.carrier')}</h2>
        </div>
        <label className="carrier-picker__search">
          <Icon name="search" />
          <input
            ref={search}
            type="search"
            role="combobox"
            aria-label={t('picker.searchLabel')}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            placeholder={t('picker.search', { count: carriers.length })}
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={onKeyDown}
            enterKeyHint="done"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {query && (
            <button type="button" className="carrier-picker__clear" aria-label={t('picker.clear')} onClick={() => { changeQuery(''); search.current?.focus(); }}>
              <Icon name="close" />
            </button>
          )}
        </label>
        <div className="carrier-picker__body">
          <div ref={list} id={listId} role="listbox" aria-labelledby={titleId} className="carrier-picker__list">
            {results ? <>
              {results.length > 0 && <div className="carrier-picker__section-title" aria-hidden="true">
                {t('picker.results.many', { count: results.length })}
              </div>}
              {options.map(renderOption)}
            </> : <>
              {autoOption && renderOption(autoOption)}
              {browsing.filter((section) => section.options.length > 0).map((section) => (
                <div key={section.key} role="group" aria-labelledby={`${baseId}-${section.key}`}>
                  <div id={`${baseId}-${section.key}`} role="presentation" className="carrier-picker__section-title">{section.title}</div>
                  {section.options.map(renderOption)}
                </div>
              ))}
              <div role="group" aria-labelledby={`${baseId}-all`}>
                <div id={`${baseId}-all`} role="presentation" className="carrier-picker__section-title">{t('picker.section.all')}</div>
                {alphabet.map((section) => (
                  // Each letter holds its own rows, so its sticky heading leaves with them.
                  <div key={section.letter} role="presentation" data-letter={section.letter}>
                    <div className="carrier-picker__letter" aria-hidden="true">{section.letter}</div>
                    {section.options.map(renderOption)}
                  </div>
                ))}
              </div>
            </>}
          </div>
          {results?.length === 0 && <p className="carrier-picker__empty" role="status">{t('picker.empty', { query: trimmed })}</p>}
          {!results && (
            <nav
              ref={rail}
              className="carrier-picker__rail"
              aria-label={t('picker.jump')}
              onPointerDown={startScrub}
              onPointerMove={(event) => { if (scrub) scrubTo(event.clientY); }}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
              onLostPointerCapture={endScrub}
            >
              {letters.map((section) => (
                <button
                  key={section.letter}
                  type="button"
                  tabIndex={-1}
                  data-letter={section.letter}
                  className={scrub?.letter === section.letter ? 'is-current' : undefined}
                  // A press already jumped; this click is an assistive technology's activation.
                  onClick={(event) => { if (event.detail === 0) jump(section.letter); }}
                >
                  {section.letter}
                </button>
              ))}
              {scrub && <span className="carrier-picker__bubble" style={{ top: scrub.y }} aria-hidden="true">{scrub.letter}</span>}
            </nav>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
