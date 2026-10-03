import { createElement } from 'react';
import mark from '../brand/mark.json';
import { useI18n } from '../i18n';

/** Peek's mark: two eyes on a postal-yellow tile, the same drawing at every size. It is decorative: the written name stands beside it. */
export function PeekMark({ size, className = '' }: { size: number; className?: string }) {
  return <svg className={`peek-mark ${className}`.trim()} viewBox={`0 0 ${mark.size} ${mark.size}`} style={{ width: size, height: size }} aria-hidden="true">
    <rect width={mark.size} height={mark.size} rx={mark.tile.radius} fill={mark.tile.fill} />
    {mark.shapes.map(({ tag, ...attributes }, index) => createElement(tag, { key: index, ...attributes }))}
  </svg>;
}

/** The mark beside the name and what the app does, for wherever the name stands alone. */
export function PeekLockup({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  return <span className={`peek-lockup ${className}`.trim()}>
    <PeekMark size={28} />
    <span className="peek-lockup__text"><span className="peek-lockup__name">{t('app.title')}</span><span className="peek-lockup__tagline">{t('app.tagline')}</span></span>
  </span>;
}
