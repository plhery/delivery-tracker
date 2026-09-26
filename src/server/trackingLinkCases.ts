import type { CarrierId } from '../types';

export interface TrackingLinkCase {
  carrier: CarrierId;
  provider?: string;
  /** Synthetic and validly shaped; never a real parcel. */
  number: string;
  /** Final address after redirects. */
  route: RegExp;
  /** Wording only the carrier's tracker shows. */
  marker: RegExp;
  /**
   * How the page proves it received the number. By default the number must be
   * looked up, displayed or prefilled. `notFound` is the carrier's specific
   * answer to an unknown number when that answer clears the number from the
   * page; `none` marks a link that carries no number or one the site ignores.
   */
  forwarding?: { notFound: RegExp } | 'none';
}

// Rendered pages behind the links the UI shows, checked daily by
// trackingLinks.live.test.ts. Routes and markers were read from the live pages,
// independently of the generated link templates, so a template that drifts
// fails here instead of passing against itself.
export const trackingLinkCases: TrackingLinkCase[] = [
  { carrier: 'swiss-post', number: '989999999999999999',
    route: /^https:\/\/service\.post\.ch\/ekp-web\/ui\//,
    marker: /Meine Sendungen|My consignments|Mes envois|Sendungsnummer/ },
  { carrier: 'postlogistics', number: '000000000000000000',
    route: /^https:\/\/service\.post\.ch\/ekp-web\/ui\//,
    marker: /Meine Sendungen|My consignments|Mes envois|Sendungsnummer/ },
  { carrier: 'swiss-post-cargo', number: 'CODEXINVALID20260831',
    route: /^https:\/\/apv\.swisspost-cargo\.com\/public\/trackandtrace\//,
    marker: /Sendungsnummer\/Referenz|Keine Daten gefunden|TRACK&TRACE/i },
  { carrier: 'quickpac', number: '440000000000000001',
    route: /^https:\/\/tracking\.app\.planzer\.ch\/delivery\/info\?/,
    marker: /Mes envois|Meine Sendungen|My shipments|aucune information|keine Informationen/i },
  { carrier: 'la-poste', number: 'AB12345678901',
    route: /^https:\/\/www\.laposte\.fr\/outils\/suivre-vos-envois(?:\?|$)/,
    marker: /suivre une lettre ou un colis|suivre un envoi|suivi de votre|numéro de suivi/i },
  { carrier: 'chronopost', number: 'XY000000005FR',
    route: /^https:\/\/www\.chronopost\.fr\/tracking-no-cms\/suivi-page\?/,
    marker: /Suivez votre colis|Informations concernant votre envoi/i },
  { carrier: 'dpd', number: '09999999999999',
    route: /^https:\/\/www\.dpdgroup\.com\/ch\/mydpd\/my-parcels\/incoming\?/,
    marker: /parcel number|Paketnummer|numéro de colis|my parcels/i,
    // The server-rendered unknown-number view deliberately clears the input.
    forwarding: { notFound: /The parcel you have chosen has not been assigned to your account/ } },
  // Cloudflare challenges automated browsers; kept so the gap stays visible.
  { carrier: 'dpd-fr', number: '000000000000',
    route: /^https:\/\/trace\.dpd\.fr\/fr\/trace\//,
    marker: /suivi|colis|parcel/i },
  { carrier: 'unknown', number: 'ZZ000000000ZZ',
    route: /^https:\/\/t\.17track\.net\/en(?:[?#]|$)/,
    marker: /TRACK|SUIVRE|Tracking Information/ },
  { carrier: 'dhl', number: '00340439999999999999',
    route: /^https:\/\/www\.dhl\.de\/en\/privatkunden\/dhl-sendungsverfolgung\.html\?/,
    marker: /shipment number|track shipment/i },
  { carrier: 'dhl-ecommerce', number: 'GM0000000000000000',
    route: /^https:\/\/www\.dhl\.com\/ch-en\/home\/tracking\.html\?/,
    marker: /tracking number|track your shipment/i },
  { carrier: 'mondial-relay', number: '00000000',
    route: /^https:\/\/www\.mondialrelay\.fr\/suivi-de-colis\//,
    marker: /suivi de colis|numéro de colis/i },
  { carrier: 'mondial-relay', provider: 'ParcelsApp', number: '00000000',
    route: /^https:\/\/parcelsapp\.com\/en\/tracking\//,
    marker: /tracking number|track package|tracking information/i },
  { carrier: 'relais-colis', number: '0000000000',
    route: /^https:\/\/www\.relaiscolis\.com\/colis\/suivre\?/,
    marker: /Suivre mon colis/i },
  { carrier: 'gls-ch', number: '88888888888',
    route: /^https:\/\/gls-group\.eu\/EU\/en\/parcel-tracking\?/,
    marker: /Parcel tracking|Track your parcel/i },
  // moncolis.gls-france.com now forwards to the group tracker.
  { carrier: 'gls-fr', number: '00ZZ00Z0',
    route: /^https:\/\/(?:moncolis\.gls-france\.com\/|gls-group\.eu\/GROUP\/[a-z]{2}\/parcel-tracking\?)/,
    marker: /Parcel tracking|Track your parcel|Suivi/i },
  { carrier: 'gls-de', number: '00000000000',
    route: /^https:\/\/(?:gls-group\.eu\/DE\/de\/paketverfolgung|www\.gls-pakete\.de\/(?:reach-)?sendungsverfolgung)/,
    marker: /Paketnummer|Sendungsverfolgung|Track ID/i },
  { carrier: 'ups', number: '1Z0000000000000000',
    route: /^https:\/\/(?:www\.)?ups\.com\/track(?:[/?]|$)/,
    marker: /tracking number|numéro de suivi|track a package/i },
  { carrier: 'fedex', number: '999999999999',
    route: /^https:\/\/www\.fedex\.com\/(?:fedextrack|wtrk\/track)\//,
    marker: /FedEx ® Tracking|Track Another Shipment|can.t find that tracking number/i },
  { carrier: 'amazon-shipping', number: 'FR0000000000',
    route: /^https:\/\/track\.amazon\.fr\/tracking\//,
    marker: /Numéro de suivi|Tracking number|Suivre un colis/i },
  // Amazon Logistics parcels are tracked from the signed-in order history.
  { carrier: 'amazon-logistics', number: 'TBA000000000000',
    route: /^https:\/\/www\.amazon\.com\/(?:ap\/signin|gp\/your-account\/order-history|your-orders)/,
    marker: /Sign in|Your Orders/i, forwarding: 'none' },
  { carrier: 'geodis', number: '1G0000000000',
    route: /^https:\/\/espace-client\.geodis\.com\/services\/destinataires\//,
    marker: /Suivre mon envoi|Numéro de suivi/i },
  // Colisweb ignores ?value= since its search became an in-page request.
  { carrier: 'colisweb', number: '99999999',
    route: /^https:\/\/www\.colisweb\.com\/suivi-livraison/,
    marker: /Suivi de votre livraison|Suivre ma livraison/i, forwarding: 'none' },
  { carrier: 'c-chez-vous', number: 'ZZZZ00000Z',
    route: /^https:\/\/www\.cchezvous\.fr\/suivi-colis/,
    marker: /Suivre ma livraison/i,
    forwarding: { notFound: /La commande est introuvable/ } },
  { carrier: 'heppner', number: '00000000',
    route: /^https:\/\/www\.heppner-group\.com\/(?:en\/consignee-track-your-order|destinataire-suivez-votre-marchandise)\//,
    marker: /track your order|suivez votre marchandise/i, forwarding: 'none' },
  { carrier: 'ciblex', number: '12345678901234',
    route: /^https:\/\/secure\.extranet\.ciblex\.fr\/extranet\/client\/corps\.php\?/,
    marker: /SUIVI DE VOS COLIS|SUIVI COLIS/i },
  { carrier: 'paack', number: 'EXCHANGE000001D',
    route: /^https:\/\/mydeliveries\.paack\.app\/tracking\?/,
    marker: /Track your order|Track My Order|Order number/i },
  { carrier: 'asendia', number: 'ASE00000000',
    route: /^https:\/\/track\.asendia\.com\/track\//,
    marker: /Tracking Portal|Track here/i },
  { carrier: 'hermes', number: '12345678',
    route: /^https:\/\/myhes\.de\//,
    marker: /Sendungsverfolgung/i, forwarding: 'none' },
  { carrier: 'hermes-de', number: '00000000000000',
    route: /^https:\/\/www\.myhermes\.de\/empfangen\/sendungsverfolgung\//,
    marker: /Sendungsverfolgung|Sendungsinformation/i },
  { carrier: 'inpost', number: '000000000000000000000000',
    route: /^https:\/\/inpost\.pl\/sledzenie-przesylek/,
    marker: /Śledzenie paczki|Śledź paczkę|numery paczek/i, forwarding: 'none' },
  { carrier: 'posti', number: 'CW000000000FR',
    route: /^https:\/\/www\.posti\.fi\/en\/tracking\//,
    marker: /Track item|Parcel tracking|Search by item ID/i },
  { carrier: 'packeta', number: 'Z0000000000',
    route: /^https:\/\/tracking\.packeta\.com\/en/,
    marker: /Parcel tracking/i,
    forwarding: { notFound: /The parcel with this number was not found/ } },
  { carrier: 'ctt', number: 'RL000000005PT',
    route: /^https:\/\/www\.ctt\.pt\/feapl_2\/app\/open\/objectSearch\/objectSearch\.jspx\?/,
    marker: /Seguir objeto/i },
  { carrier: 'correos-spain', number: 'PR000000000000000C',
    route: /^https:\/\/www\.correos\.es\/es\/es\/herramientas\/localizador\//,
    marker: /Localizador de envíos|No encontramos resultados/i },
  { carrier: 'canada-post', number: '0000000000000000',
    route: /^https:\/\/www\.canadapost-postescanada\.ca\/track-reperage\/en/,
    marker: /Track results|Track/ },
  { carrier: 'india-post', number: 'EE000000000IN',
    route: /^https:\/\/myspeedpost\.com\/track\?/,
    marker: /consignment|speed post tracking/i },
  { carrier: 'pos-malaysia', number: 'MYPM00000000099',
    route: /^https:\/\/tracking\.pos\.com\.my\/tracking\//,
    marker: /TRACK MY PARCEL|Parcel Tracking/i },
  { carrier: 'spring-gds', number: 'LT000000000NL',
    route: /^https:\/\/postnl\.post\/track\?/,
    marker: /tracking numbers|track your parcels/i },
  { carrier: 'sunyou', number: 'SY00000000000',
    route: /^https:\/\/sypost\.net\/search\?/,
    marker: /Track Number|Not Found/ },
  { carrier: 'aliexpress', number: 'LP00000000000000',
    route: /^https:\/\/global\.cainiao\.com\/detail\.htm\?/,
    marker: /Track|Suivre/ },
  { carrier: 'ems', number: 'EB000000005CN',
    route: /^https:\/\/items\.ems\.post\/api\/publicTracking\/track\?/,
    marker: /Public Tracking|no results found/i },
  { carrier: 'japan-post', number: 'CN000000005JP',
    route: /^https:\/\/trackings\.post\.japanpost\.jp\/services\/srv\/search\/direct\?/,
    marker: /Track & Trace|Your item was not found/i },
  // The shared page links UK tracking and the international POST-only form.
  { carrier: 'evri', number: 'H000000000000001',
    route: /^https:\/\/www\.evri\.com\/track-a-parcel\/?$/,
    marker: /Parcel tracking is easy with Evri|Track a parcel/i, forwarding: 'none' },
];

/**
 * Carriers with their own adapter (or no automatic tracking) whose link no
 * case above opens, and why. Universal carriers are out of scope: their
 * tracking comes from shared providers, not the page the link opens.
 */
export const uncheckedTrackingLinks: Partial<Record<CarrierId, string>> = {
  'colis-prive': 'an unknown number-and-postcode credential redirects to the homepage, so only a real parcel verifies the link',
  'poste-italiane': 'the results page exposes no readable text to headless Chrome',
  usps: 'tools.usps.com answers automated Chrome with an anti-bot script instead of the page',
};
