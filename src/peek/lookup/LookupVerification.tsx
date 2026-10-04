import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { isDemoBuild } from '../../lib/buildMode';
import { mountLookupVerification } from './verification';

export function LookupVerification({ active }: { active: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const verifier = useRef<ReturnType<typeof mountLookupVerification> | null>(null);
  const { locale } = useI18n();
  useEffect(() => {
    if (!container.current || isDemoBuild) return;
    const mounted = mountLookupVerification(container.current, locale);
    verifier.current = mounted;
    return () => { mounted.dispose(); verifier.current = null; };
  }, [locale]);
  useEffect(() => { if (active) verifier.current?.warm(); }, [active, locale]);
  return <div ref={container} className="door-verification" />;
}
