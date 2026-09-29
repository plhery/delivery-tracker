import { userErrorMessage } from '../lib/userMessages';
import { useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  type CarrierInputField,
  carrierInfo,
  carrierRequirements,
  carrierTrackingHintKey,
  detectCarrierMatch,
  formatTrackingNumber,
  requirementSatisfied,
} from '../lib/carriers';
import { useI18n } from '../i18n';
import { useSheetDialog } from '../lib/modal';
import type {
  CarrierId,
  ParcelCarrierInput,
  ParcelWithEvents,
} from '../types';
import { CarrierTruck } from './CarrierMark';
import { CarrierPickerSheet, type CarrierPickerSection } from './CarrierPickerSheet';
import { Icon } from './Icon';

export function ChangeCarrierSheet({
  parcel,
  initialCarrier = parcel.carrier,
  usedCarriers = [],
  onChange,
  onClose: onDismissed,
}: {
  parcel: ParcelWithEvents;
  /** Preselected carrier, such as one that recognized the number and needs a postcode. */
  initialCarrier?: CarrierId;
  /** The carriers of the latest parcels, offered first in the picker. */
  usedCarriers?: readonly CarrierId[];
  onChange: (input: ParcelCarrierInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const [selectedCarrier, setSelectedCarrier] = useState<CarrierId>(initialCarrier);
  const [trackingUrl, setTrackingUrl] = useState(initialCarrier === parcel.carrier ? parcel.trackingUrl ?? '' : '');
  const [dpdPostcode, setDpdPostcode] = useState(initialCarrier === parcel.carrier ? parcel.dpdPostcode ?? '' : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const carrierButton = useRef<HTMLButtonElement>(null);
  const fieldId = useId();
  const [dialog, onClose] = useSheetDialog<HTMLDivElement>(true, onDismissed, carrierButton);
  const carrier = carrierInfo(selectedCarrier, locale);
  // The picker leads with the parcel's own carrier when no longer offered,
  // then the carriers its number fits, then the ones used before.
  const detected = detectCarrierMatch(parcel.trackingNumber);
  const fitting = (detected.confidence === 'high' ? [detected.carrier] : detected.candidates)
    .filter((id) => carrierInfo(id).capabilities.selectable);
  const pickerSections: CarrierPickerSection[] = [
    ...(carrierInfo(parcel.carrier).capabilities.selectable ? [] : [
      { key: 'current', title: t('picker.section.current'), carriers: [parcel.carrier] },
    ]),
    { key: 'fits', title: t(detected.confidence === 'high' ? 'picker.section.detected' : 'picker.section.fits'), carriers: fitting },
    { key: 'used', title: t('picker.section.used'), carriers: usedCarriers.filter((id) => !fitting.includes(id)) },
  ].filter((section) => section.carriers.length > 0);
  const requirements = carrierRequirements(selectedCarrier, parcel.trackingNumber);
  const valueFor = (field: CarrierInputField) => field === 'trackingUrl'
    ? trackingUrl
    : dpdPostcode;
  const requirementsSatisfied = requirements.every((requirement) =>
    requirementSatisfied(requirement, valueFor(requirement.field)));
  const nextTrackingUrl = requirements.some(({ field }) => field === 'trackingUrl')
    ? trackingUrl.trim()
    : undefined;
  const nextPostcode = requirements.some(({ field }) => field === 'dpdPostcode')
    ? dpdPostcode.trim()
    : undefined;
  const changed = selectedCarrier !== parcel.carrier
    || (nextTrackingUrl ?? '') !== (parcel.trackingUrl ?? '')
    || (nextPostcode ?? '') !== (parcel.dpdPostcode ?? '');

  function selectCarrier(value: CarrierId) {
    setSelectedCarrier(value);
    setTrackingUrl(value === parcel.carrier ? parcel.trackingUrl ?? '' : '');
    setDpdPostcode(value === parcel.carrier ? parcel.dpdPostcode ?? '' : '');
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!requirementsSatisfied || !changed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onChange({
        carrier: selectedCarrier,
        trackingUrl: nextTrackingUrl,
        dpdPostcode: nextPostcode,
      });
      onClose();
    } catch (reason) {
      setError(userErrorMessage(reason, t, 'detail.changeCarrierFailed'));
      setSaving(false);
    }
  }

  return <>{createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="sheet change-carrier-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-carrier-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__grabber" aria-hidden="true" />
        <div className="sheet__heading">
          <div>
            <p className="sheet__eyebrow">{t('detail.label')}</p>
            <h2 className="sheet__title" id="change-carrier-title">
              {t('detail.changeCarrier')}
            </h2>
          </div>
          <button
            type="button"
            className="sheet__close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="sheet__intro">
          {t('detail.changeCarrierDescription', {
            number: formatTrackingNumber(parcel.trackingNumber),
          })}
        </p>
        <form className="sheet__form" onSubmit={submit}>
          <div className="field">
            <span className="field__label" id={`${fieldId}-label`}>{t('add.carrier')}</span>
            <button
              ref={carrierButton}
              type="button"
              className="field__input carrier-field"
              aria-haspopup="dialog"
              aria-labelledby={`${fieldId}-label ${fieldId}-value`}
              onClick={() => setPickerOpen(true)}
            >
              <CarrierTruck carrier={carrier} />
              <span className="carrier-field__name" id={`${fieldId}-value`}>{carrier.name}</span>
              <Icon name="chevron" />
            </button>
          </div>
          <div className="sheet__carrier-card">
            <span className="sheet__carrier-mark" aria-hidden="true" />
            <span className="sheet__carrier-copy">
              <small>{t('add.carrier')}</small>
              <strong>{carrier.name}</strong>
              <span>
                {t(carrierTrackingHintKey(carrier.id), { carrier: carrier.name })}
              </span>
            </span>
          </div>
          {requirements.map((requirement) => (
            <label className="field" key={requirement.field}>
              <span className="field__label">
                {locale === 'en'
                  ? requirement.label
                  : t(`add.requirement.${requirement.field}`)}
                {requirement.optional && <> <small>{t('add.optional')}</small></>}
              </span>
              <input
                className="field__input"
                type={requirement.type}
                inputMode={requirement.inputMode}
                autoComplete={requirement.autoComplete}
                value={valueFor(requirement.field)}
                placeholder={requirement.placeholder}
                pattern={requirement.pattern}
                maxLength={requirement.maxLength}
                onChange={(event) => {
                  const value = requirement.inputMode === 'numeric'
                    ? event.target.value.replace(/\D/g, '').slice(0, requirement.maxLength)
                    : event.target.value;
                  if (requirement.field === 'trackingUrl') setTrackingUrl(value);
                  else setDpdPostcode(value);
                }}
                autoCapitalize={requirement.type === 'url' ? 'none' : undefined}
                autoCorrect="off"
                spellCheck={false}
                required={!requirement.optional}
              />
              {requirement.help && (
                <small className="field__help">
                  {t(requirement.field === 'trackingUrl' ? 'add.requirement.trackingUrlHelp'
                    : requirement.optional ? 'add.requirement.dpdPostcodeOptionalHelp'
                      : 'add.requirement.dpdPostcodeHelp', { carrier: carrier.name })}
                </small>
              )}
            </label>
          ))}
          {error && <p className="sheet__error" role="alert">{error}</p>}
          <div className="sheet__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={onClose}
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={!requirementsSatisfied || !changed || saving}
            >
              {saving ? t('detail.changingCarrier') : t('detail.saveCarrier')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )}
  {/* Outside the backdrop: a click in the picker must not reach the sheet's dismiss handler. */}
  {pickerOpen && (
    <CarrierPickerSheet
      selected={selectedCarrier}
      sections={pickerSections}
      onSelect={(choice) => {
        if (choice !== 'auto') selectCarrier(choice);
        setPickerOpen(false);
      }}
      onClose={() => setPickerOpen(false)}
    />
  )}
  </>;
}
