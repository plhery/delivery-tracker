import { Icon } from '../../components/Icon';
import { useI18n } from '../../i18n';

/** Under a gift on its way: why the page says so little. */
export function GiftSurprise() {
  const { t } = useI18n();
  return <p className="peekp-surprise"><Icon name="gift" />{t('share.gift.surprise')}</p>;
}

/**
 * What a gift's link carried all along and shows once the parcel is
 * delivered: the sender's note, who it is from, and what is inside. None of
 * it ever reached a server.
 */
export function GiftNote({ note, from, inside }: { note: string | null; from: string | null; inside: string | null }) {
  const { t } = useI18n();
  if (!note && !from && !inside) return null;
  return <section className="peekp-giftnote">
    {note && <p className="peekp-giftnote__text">{note}</p>}
    {from && <p className="peekp-giftnote__from">— {from}</p>}
    {inside && <p className="peekp-giftnote__inside"><Icon name="gift" /><span>{t('share.gift.inside')} <strong>{inside}</strong></span></p>}
  </section>;
}
