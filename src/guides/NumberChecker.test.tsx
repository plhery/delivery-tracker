import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../shared/locales/de.json';
import en from '../../shared/locales/en.json';
import fr from '../../shared/locales/fr.json';
import { CARRIER_LINKS } from '../generated/carriers';
import { CARRIER_HANDOFF_STORAGE_KEY } from '../lib/carrierHandoff';
import type { Locale } from '../lib/locale';
import { translateMessage, type Messages, type Translate } from '../lib/messages';
import { GuidePage } from './GuidePage';
import { parseGuide } from './markdown';

const analytics = vi.hoisted(() => ({ trackScreen: vi.fn(), startAnalytics: vi.fn(async () => undefined) }));
vi.mock('../lib/analytics', () => analytics);

const t = (locale: Locale, messages: Messages): Translate => (key, variables) => translateMessage(locale, key, variables, messages);
const guide = parseGuide([
  '---', 'title: Tracking number formats', 'description: Which carrier a number belongs to.', 'slug: tracking-number-formats',
  'picture: Pip reads a label.', 'published: 2026-10-04', 'updated: 2026-10-10', '---', '',
  'The lead: letters and length tell the carrier.', '',
  ':::checker', ':::', '',
  '## Formats', '', 'A paragraph.', '',
  ':::sources', '- [UPU](https://www.upu.int/) – the standard', ':::', '',
].join('\n'));
const page = (locale: Locale, messages: Messages) => render(<GuidePage guide={guide} id="tracking-number-formats" locale={locale} t={t(locale, messages)} links={[]} others={[]} />);
const yunexpress = (locale: Locale) => CARRIER_LINKS[locale].find(({ id }) => id === 'yunexpress')!;
const assign = vi.fn();

beforeEach(() => {
  assign.mockClear();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('the number checker in a guide', () => {
  it('stands where the guide places it, and says what it does until something is typed', () => {
    page('en', en);
    const field = screen.getByRole('textbox', { name: 'Which carrier is this number?' });
    expect(field).toHaveAttribute('placeholder', en['add.trackingPlaceholder']);
    expect(field).toHaveAccessibleDescription(en['guides.checker.hint']);
    // Below the lead, above the first section.
    expect(document.querySelector('.guide-lead')!.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(field.compareDocumentPosition(screen.getByRole('heading', { level: 2, name: 'Formats' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the one carrier a number’s shape proves, leading to its page where the guide’s language has one', async () => {
    const user = userEvent.setup();
    page('en', en);
    const field = screen.getByRole('textbox', { name: 'Which carrier is this number?' });
    await user.type(field, '1Z999AA10123456784');
    const result = document.getElementById('number-checker-result')!;
    expect(await within(result).findByText('UPS')).toBeVisible();
    expect(result).toHaveTextContent(`1Z999AA10123456784${en['add.detectedCarrier']}UPS`);
    expect(within(result).queryByRole('link')).toBeNull();
    await user.clear(field);
    await user.type(field, 'YT1234567890123456');
    expect(await within(result).findByRole('link', { name: 'YunExpress' })).toHaveAttribute('href', `/carriers/${yunexpress('en').slug}`);
    expect(result).not.toHaveTextContent(en['guides.checker.maybeNote']);
    // Emptied, it says what it does again.
    await user.clear(field);
    expect(result).toHaveTextContent(en['guides.checker.hint']);
  });

  it('lists the carriers a shape fits without proving one, by the name of their page in the guide’s language', async () => {
    const user = userEvent.setup();
    page('de', de);
    await user.type(screen.getByRole('textbox', { name: de['guides.checker.label'] }), 'CNG12345678900000');
    const result = document.getElementById('number-checker-result')!;
    const cainiao = CARRIER_LINKS.de.find(({ id }) => id === 'cainiao')!;
    expect(await within(result).findByRole('link', { name: 'Cainiao' })).toHaveAttribute('href', `/de/carriers/${cainiao.slug}`);
    expect(result).toHaveTextContent(de['guides.checker.maybe']);
    expect(result).toHaveTextContent(de['guides.checker.maybeNote']);
  });

  it('says when no carrier writes numbers so, when a postal number’s check digit fails, and when it is an order number', async () => {
    const user = userEvent.setup();
    page('en', en);
    const field = screen.getByRole('textbox', { name: 'Which carrier is this number?' });
    const result = document.getElementById('number-checker-result')!;
    await user.type(field, '12345');
    expect(await within(result).findByText(en['guides.checker.none'])).toBeVisible();
    await user.clear(field);
    // A letter where the check digit stands: read as the digit it looks like, the number adds up.
    await user.type(field, 'RR12345678SCH');
    expect(await within(result).findByText('RR123456785CH')).toBeVisible();
    expect(result).toHaveTextContent(`${en['door.typo.check']} Did you mean RR123456785CH?`);
    await user.clear(field);
    await user.type(field, '123-1234567-1234567');
    expect(await within(result).findByText(en['door.order.title'])).toBeVisible();
  });

  it('reads every number of a pasted message, each with its carrier', async () => {
    const user = userEvent.setup();
    page('fr', fr);
    const field = screen.getByRole('textbox', { name: fr['guides.checker.label'] });
    await user.click(field);
    await user.paste('Ton colis UPS 1Z999AA10123456784\nEt YunExpress YT1234567890123456');
    const result = document.getElementById('number-checker-result')!;
    expect(await within(result).findByRole('link', { name: 'YunExpress' })).toHaveAttribute('href', `/fr/carriers/${yunexpress('fr').slug}`);
    expect(within(result).getAllByRole('listitem').map((item) => item.querySelector('code')!.textContent)).toEqual(['1Z999AA10123456784', 'YT1234567890123456']);
  });

  it('hands what was typed to the landing of the guide’s language, never through its address, and goes nowhere empty', async () => {
    const user = userEvent.setup();
    page('de', de);
    const field = screen.getByRole('textbox', { name: de['guides.checker.label'] });
    await user.click(screen.getByRole('button', { name: de['sample.yours.action'] }));
    expect(assign).not.toHaveBeenCalled();
    expect(field).toHaveFocus();
    await user.type(field, '1Z999AA10123456784{Enter}');
    expect(assign).toHaveBeenCalledExactlyOnceWith('/de');
    expect(JSON.parse(sessionStorage.getItem(CARRIER_HANDOFF_STORAGE_KEY)!)).toMatchObject({ text: '1Z999AA10123456784' });
    // Without a script, the form opens the landing alone: the field has no name to send.
    expect(field.closest('form')).toHaveAttribute('action', '/de');
    expect(field).not.toHaveAttribute('name');
  });

  it('opens the landing at its own address from an English guide', async () => {
    const user = userEvent.setup();
    page('en', en);
    await user.type(screen.getByRole('textbox', { name: 'Which carrier is this number?' }), 'RR123456785CH');
    await user.click(screen.getByRole('button', { name: en['sample.yours.action'] }));
    expect(assign).toHaveBeenCalledExactlyOnceWith('/home');
  });
});
