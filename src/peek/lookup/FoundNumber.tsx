import { useI18n } from '../../i18n';

/**
 * "Found 1234567899 in the pasted text": the number read out of a link or a
 * message, so the reader can check it against what they pasted. Languages
 * that lead with the number have an empty prefix.
 */
export function FoundNumber({ number, source, className }: {
  number: string;
  source: 'link' | 'text';
  className?: string;
}) {
  const { t } = useI18n();
  const prefix = t('add.foundPrefix');
  return <p className={className}>
    {prefix}{prefix ? ' ' : ''}
    <strong>{number}</strong>{' '}
    {t(source === 'link' ? 'add.foundLinkSuffix' : 'add.foundTextSuffix')}
  </p>;
}
