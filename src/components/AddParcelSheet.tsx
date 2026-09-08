import { userErrorMessage } from '../lib/userMessages';
import { useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  type CarrierInputField,
  carrierInfo,
  carrierRequirements,
  carrierTrackingHintKey,
  formatTrackingNumber,
  parseTrackingInput,
  SELECTABLE_CARRIERS,
  tracksAutomatically,
} from '../lib/carriers';
import {
  ParcelAlreadyExistsError,
  type CarrierId,
  type NewParcelInput,
} from '../types';
import { useSheetDialog } from '../lib/modal';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

export function AddParcelSheet({
  onAdd,
  onClose: onDismissed,
  lastDpdPostcode,
  initialLabel = '',
  initialTrackingInput = '',
  onOpenParcel,
}: {
  onAdd: (input: NewParcelInput) => Promise<unknown>;
  onClose: () => void;
  onOpenParcel?: (parcelId: string) => void;
  lastDpdPostcode?: string;
  initialLabel?: string;
  initialTrackingInput?: string;
}) {
  const { locale, t } = useI18n();
  const [label, setLabel] = useState(initialLabel);
  const [trackingInputValue, setTrackingInputValue] = useState(initialTrackingInput);
  const [carrierInputs, setCarrierInputs] = useState<Record<CarrierInputField, string>>({
    trackingUrl: '',
    dpdPostcode: '',
  });
  const [carrierPostcodes, setCarrierPostcodes] = useState<Partial<Record<CarrierId, string>>>({
    dpd: lastDpdPostcode ?? '',
  });
  const [selectedCarrier, setSelectedCarrier] = useState<CarrierId | 'auto'>('auto');
  const [showCarrierPicker, setShowCarrierPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingParcelId, setExistingParcelId] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const trackingInput = useRef<HTMLTextAreaElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const [dialog, onClose] = useSheetDialog<HTMLDivElement>(true, onDismissed, titleInput);

  const parsedTracking = parseTrackingInput(trackingInputValue);
  const trackingNumber = parsedTracking.trackingNumber;
  const resolvedCarrier = selectedCarrier === 'auto' ? parsedTracking.carrier : selectedCarrier;
  const carrier = trackingNumber ? carrierInfo(resolvedCarrier, locale) : null;
  const requirements = carrier ? carrierRequirements(carrier.id, trackingNumber) : [];
  const requiresCarrierConfirmation =
    selectedCarrier === 'auto' && parsedTracking.confidence === 'low'
    && !tracksAutomatically(parsedTracking.carrier);
  const parsedCarrierTrackingUrl =
    parsedTracking.carrier === resolvedCarrier ? parsedTracking.trackingUrl : undefined;
  const carrierInputValue = (field: CarrierInputField) =>
    field === 'trackingUrl' && parsedCarrierTrackingUrl
      ? parsedCarrierTrackingUrl
      : field === 'dpdPostcode'
        ? carrierPostcodes[resolvedCarrier] ?? ''
        : carrierInputs[field];
  const requirementsSatisfied = requirements.every((requirement) => {
    const value = carrierInputValue(requirement.field).trim();
    return value && (!requirement.pattern || new RegExp(requirement.pattern).test(value));
  });
  const carrierHint = carrier
    ? requiresCarrierConfirmation
      ? t('add.confirmCarrier', {
        carriers: parsedTracking.candidates
          .map((candidate) => carrierInfo(candidate, locale).name)
          .join(` ${t('auth.or')} `),
      })
      : t(carrierTrackingHintKey(carrier.id), { carrier: carrier.name })
    : '';
  const carrierPickerVisible = Boolean(trackingNumber) && (
    showCarrierPicker || requiresCarrierConfirmation || carrier?.id === 'unknown'
  );

  async function pasteTrackingInput() {
    setPasteError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error('Clipboard is empty');
      setTrackingInputValue(text);
    } catch {
      setPasteError(t('add.pasteFailed'));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trackingNumber.trim() || requiresCarrierConfirmation || !requirementsSatisfied || saving) return;
    setSaving(true);
    setError(null);
    setExistingParcelId(null);
    try {
      await onAdd({
        trackingNumber: trackingNumber.trim(),
        label: label.trim(),
        carrier: resolvedCarrier,
        trackingUrl: requirements.some(({ field }) => field === 'trackingUrl')
          ? carrierInputValue('trackingUrl').trim()
          : undefined,
        dpdPostcode: requirements.some(({ field }) => field === 'dpdPostcode')
          ? carrierInputValue('dpdPostcode').trim()
          : undefined,
      });
      onClose();
    } catch (err) {
      if (err instanceof ParcelAlreadyExistsError) {
        setError(t('add.alreadyExists'));
        setExistingParcelId(err.parcelId);
      } else {
        setError(userErrorMessage(err, t, 'add.failed'));
      }
      setSaving(false);
    }
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="sheet add-parcel-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-parcel-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__grabber" aria-hidden="true" />
        <div className="sheet__heading">
          <div>
            <h2 className="sheet__title" id="add-parcel-title">{t('add.title')}</h2>
          </div>
          <button
            type="button"
            className="sheet__close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="sheet__form">
          <label className="field">
            <span className="field__label">{t('design.parcelTitle')} <small>{t('add.optional')}</small></span>
            <input
              className="field__input"
              type="text"
              ref={titleInput}
              value={label}
              placeholder={t('add.contentsPlaceholder')}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
            />
          </label>

          <div className="field">
            <div className="field__label">
              <label htmlFor="add-parcel-tracking">{t('add.tracking')}</label>
              <button
                type="button"
                className="field__inline-action"
                onClick={() => void pasteTrackingInput()}
              >
                <Icon name="copy" />{t('add.paste')}
              </button>
            </div>
            <textarea
              id="add-parcel-tracking"
              className="field__input field__input--tracking"
              ref={trackingInput}
              value={trackingInputValue}
              placeholder={t('add.trackingPlaceholder')}
              onChange={(e) => {
                setTrackingInputValue(e.target.value);
                if (existingParcelId) {
                  setExistingParcelId(null);
                  setError(null);
                }
              }}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>
          {pasteError && <p className="sheet__error" role="status">{pasteError}</p>}
          {trackingInputValue.trim() && !trackingNumber && (
            <p className="sheet__error" role="status">
              {t('add.notFound')}
            </p>
          )}
          {parsedTracking.source !== 'number' && trackingNumber && (
            <p className="sheet__carrier-hint">
              {t('add.foundPrefix')}{t('add.foundPrefix') ? ' ' : ''}
              <strong>{formatTrackingNumber(trackingNumber)}</strong>{' '}
              {t(parsedTracking.source === 'link'
                ? 'add.foundLinkSuffix'
                : 'add.foundTextSuffix')}
            </p>
          )}
          {carrier && trackingNumber && (
            <div className={`sheet__carrier-card${requiresCarrierConfirmation || !tracksAutomatically(carrier.id) ? ' sheet__carrier-card--warning' : ''}`}>
              <span className="sheet__carrier-mark" aria-hidden="true" />
              <span className="sheet__carrier-copy">
                <small>{selectedCarrier === 'auto' && carrier.id !== 'intl-post' && carrier.id !== 'unknown'
                  ? t('add.detectedCarrier')
                  : t('add.carrier')}</small>
                <strong>{carrier.name}</strong>
                {(requiresCarrierConfirmation || !tracksAutomatically(carrier.id)) && <span>{carrierHint}</span>}
              </span>
              {!requiresCarrierConfirmation
                && (selectedCarrier !== 'auto' || parsedTracking.carrier !== 'unknown') && (
                <button
                  type="button"
                  onClick={() => setShowCarrierPicker((visible) => !visible)}
                >
                  {carrierPickerVisible
                    ? selectedCarrier === 'auto'
                      ? t('add.useDetectedCarrier')
                      : t('common.close')
                    : t('add.changeCarrier')}
                </button>
              )}
            </div>
          )}
          {carrierPickerVisible && (
            <label className="field">
              <span className="field__label">{t('add.carrier')}</span>
              <select
                className="field__input"
                value={selectedCarrier}
                onChange={(e) => setSelectedCarrier(e.target.value as CarrierId | 'auto')}
              >
                <option value="auto">{t('add.detect')}</option>
                {SELECTABLE_CARRIERS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}{tracksAutomatically(option.id) ? '' : ` (${t('add.linkOnly')})`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {requirements
            .filter(({ field }) => field !== 'trackingUrl' || !parsedCarrierTrackingUrl)
            .map((requirement) => (
              <label className="field" key={requirement.field}>
                <span className="field__label">
                  {locale === 'en'
                    ? requirement.label
                    : t(`add.requirement.${requirement.field}`)}
                </span>
                <input
                  className="field__input"
                  type={requirement.type}
                  inputMode={requirement.inputMode}
                  autoComplete={requirement.autoComplete}
                  value={carrierInputValue(requirement.field)}
                  placeholder={requirement.placeholder}
                  pattern={requirement.pattern}
                  maxLength={requirement.maxLength}
                  onChange={(event) => {
                    const value = requirement.inputMode === 'numeric'
                      ? event.target.value.replace(/\D/g, '').slice(0, requirement.maxLength)
                      : event.target.value;
                    if (requirement.field === 'dpdPostcode') {
                      setCarrierPostcodes((current) => ({
                        ...current,
                        [resolvedCarrier]: value,
                      }));
                    } else {
                      setCarrierInputs((current) => ({
                        ...current,
                        [requirement.field]: value,
                      }));
                    }
                  }}
                  autoCapitalize={requirement.type === 'url' ? 'none' : undefined}
                  autoCorrect="off"
                  spellCheck={false}
                  required
                />
                {requirement.help && (
                  <small className="field__help">
                    {t(requirement.field === 'dpdPostcode'
                      ? 'add.requirement.dpdPostcodeHelp'
                      : 'add.requirement.trackingUrlHelp')}
                  </small>
                )}
              </label>
            ))}
          {error && (
            <p className="sheet__error" role="alert">
              <span>{error}</span>
              {existingParcelId && onOpenParcel && (
                <>{' '}
                  <a
                    href={`/?parcel=${encodeURIComponent(existingParcelId)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onClose();
                      onOpenParcel(existingParcelId);
                    }}
                  >
                    {t('add.openExisting')}
                  </a>
                </>
              )}
            </p>
          )}
          <div className="sheet__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={
                !trackingNumber
                || requiresCarrierConfirmation
                || !requirementsSatisfied
                || saving
              }
            >
              {saving ? t('add.adding') : t('app.addParcel')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
