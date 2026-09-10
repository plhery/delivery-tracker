import { amazonOrdersUrl, isAmazonTrackingNumber, requiresAmazonAccount } from '../lib/amazon';
import { trackAction } from '../lib/analytics';
import { userErrorMessage } from '../lib/userMessages';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  type CarrierInputField,
  carrierInfo,
  carrierRequirements,
  carrierTrackingHintKey,
  formatTrackingNumber,
  normalizeTrackingNumber,
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
import './AddParcelSheet.css';
import { lookupCarrier } from '../lib/carrierDetection';
import type { ApiAuth } from '../lib/apiClient';
import type { ApiCarrierDetectionResponse } from '../generated/apiContract';

export function AddParcelSheet({
  onAdd,
  onClose: onDismissed,
  lastDpdPostcode,
  initialLabel = '',
  initialTrackingInput = '',
  onOpenParcel,
  onAdded,
  apiAuth,
}: {
  onAdd: (input: NewParcelInput) => Promise<{ id: string } | void>;
  onClose: () => void;
  onOpenParcel?: (parcelId: string) => void;
  onAdded?: (parcelId: string) => void;
  lastDpdPostcode?: string;
  initialLabel?: string;
  initialTrackingInput?: string;
  apiAuth?: ApiAuth;
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
  const [verifiedCarrier, setVerifiedCarrier] = useState<ApiCarrierDetectionResponse>();
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [showCarrierPicker, setShowCarrierPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingParcelId, setExistingParcelId] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const trackingInput = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const saved = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [dialog, onClose] = useSheetDialog<HTMLDivElement>(true, () => {
    onDismissed();
    if (saved.current) onAdded?.(saved.current);
  }, trackingInput);

  // Mobile keyboards resize the visual viewport without resizing the layout
  // viewport. Keep the full-screen form and its action inside the visible area.
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = backdrop.current;
    if (!viewport || !element) return;
    const update = () => {
      // Leave native pinch zoom alone rather than shrinking the form with it.
      if (viewport.scale !== 1) return;
      element.style.setProperty('--add-viewport-height', `${viewport.height}px`);
      element.style.setProperty('--add-viewport-top', `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  const parsedTracking = parseTrackingInput(trackingInputValue);
  const trackingNumber = parsedTracking.trackingNumber;
  const normalizedNumber = normalizeTrackingNumber(trackingNumber);
  const amazonNumber = isAmazonTrackingNumber(normalizedNumber);
  const shouldLookup = Boolean(apiAuth) && (amazonNumber || (selectedCarrier === 'auto'
    && parsedTracking.carrier === 'unknown' && /^\d{11,12}$/.test(normalizedNumber)));
  const lookingUp = shouldLookup && verifiedCarrier?.trackingNumber !== normalizedNumber;
  const currentVerification = verifiedCarrier?.trackingNumber === normalizedNumber ? verifiedCarrier : undefined;
  const shippingConfirmed = amazonNumber && currentVerification?.carrier === 'amazon-shipping'
    && ['available', 'expired'].includes(currentVerification.amazonShippingStatus ?? '');
  const accountRequired = amazonNumber ? !shippingConfirmed : requiresAmazonAccount(selectedCarrier);
  const detectedCarrier = shouldLookup && currentVerification ? currentVerification.carrier : parsedTracking.carrier;
  const resolvedCarrier = amazonNumber ? shippingConfirmed ? 'amazon-shipping' : 'amazon-logistics'
    : selectedCarrier === 'auto' ? detectedCarrier : selectedCarrier;
  useEffect(() => {
    if (!shouldLookup || !apiAuth) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void lookupCarrier(normalizedNumber, apiAuth, controller.signal).then((result) => {
        if (!controller.signal.aborted) setVerifiedCarrier(result);
      }).catch(() => {
        if (!controller.signal.aborted) setVerifiedCarrier({ trackingNumber: normalizedNumber, carrier: amazonNumber ? 'amazon-logistics' : 'unknown', ...(amazonNumber ? { amazonShippingStatus: 'unavailable' as const } : {}) });
      });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [shouldLookup, normalizedNumber, apiAuth, amazonNumber, lookupAttempt]);
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
    ? shippingConfirmed ? t(currentVerification?.amazonShippingStatus === 'expired' ? 'add.amazonHistoryExpired' : 'add.amazonShippingConfirmed') : requiresCarrierConfirmation
      ? t('add.confirmCarrier', {
        carriers: parsedTracking.candidates
          .map((candidate) => carrierInfo(candidate, locale).name)
          .join(` ${t('auth.or')} `),
      })
      : t(carrierTrackingHintKey(carrier.id), { carrier: carrier.name })
    : '';
  const carrierPickerVisible = !amazonNumber && Boolean(trackingNumber) && (
    showCarrierPicker || requiresCarrierConfirmation || carrier?.id === 'unknown'
  );

  async function pasteTrackingInput() {
    setPasteError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error('Clipboard is empty');
      trackAction('parcel-paste', 'success');
      setTrackingInputValue(text);
    } catch {
      setPasteError(t('add.pasteFailed'));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (accountRequired || !trackingNumber.trim() || lookingUp || requiresCarrierConfirmation || !requirementsSatisfied || saving) return;
    setSaving(true);
    setError(null);
    setExistingParcelId(null);
    try {
      const parcel = await onAdd({
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
      if (!mounted.current) return;
      saved.current = parcel?.id ?? null;
      onClose();
    } catch (err) {
      if (!mounted.current) return;
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
    <div ref={backdrop} className="sheet-backdrop add-parcel-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="sheet add-parcel-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-parcel-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
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
          <div className="add-parcel-fields">
            <div className="add-parcel-tracking">
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
                  rows={2}
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
                <div className={`add-parcel-carrier${amazonNumber ? ' add-parcel-carrier--account' : ''}`} aria-live="polite" aria-busy={lookingUp}>
                  <div className="add-parcel-carrier__row">
                    <Icon name="truck" />
                    <span className="add-parcel-carrier__identity">
                      <strong>{carrier.name}</strong>
                      <small>{selectedCarrier === 'auto' && carrier.id !== 'intl-post' && carrier.id !== 'unknown'
                        ? t('add.detectedCarrier')
                        : t('add.carrier')}</small>
                    </span>
                    {!amazonNumber && !requiresCarrierConfirmation
                      && (selectedCarrier !== 'auto' || detectedCarrier !== 'unknown') && (
                      <button
                        type="button"
                        aria-expanded={carrierPickerVisible}
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
                  {(shippingConfirmed || requiresCarrierConfirmation || !tracksAutomatically(carrier.id)) && (
                    <p className="add-parcel-carrier__hint">{carrierHint}</p>
                  )}
                  {amazonNumber && lookingUp && <p className="add-parcel-carrier__hint">{t('add.amazonChecking')}</p>}
                  {amazonNumber && currentVerification?.amazonShippingStatus === 'unavailable' && (
                    <div>
                      <p className="add-parcel-carrier__hint">{t('add.amazonCheckUnavailable')}</p>
                      <button type="button" className="add-parcel-carrier__account-link" onClick={() => { setVerifiedCarrier(undefined); setLookupAttempt((attempt) => attempt + 1); }}>{t('add.amazonRetry')}</button>
                    </div>
                  )}
                  {accountRequired && (
                    <a className="add-parcel-carrier__account-link" href={amazonOrdersUrl(normalizedNumber)} target="_blank" rel="noopener noreferrer">
                      {t('add.openAmazonOrders')}
                    </a>
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
                        {option.name}{tracksAutomatically(option.id) || requiresAmazonAccount(option.id) ? '' : ` (${t('add.linkOnly')})`}
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
            </div>
            <label className="field">
              <span className="field__label">{t('design.parcelTitle')} <small>{t('add.optional')}</small></span>
              <input
                className="field__input"
                type="text"
                value={label}
                placeholder={t('add.contentsPlaceholder')}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
              />
            </label>
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
          </div>
          <div className="sheet__actions">
            <button
              type="button"
              className="text-button add-parcel-cancel"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={
                !trackingNumber
                || accountRequired || lookingUp || requiresCarrierConfirmation
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
