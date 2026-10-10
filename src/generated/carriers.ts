// Generated from content/carriers by scripts/generate-guides.mjs. Do not edit.
import type { Locale } from '../lib/locale';

/**
 * A carrier's page in one language: the carrier's id, its id in Universal Parcel Scraper's catalog, its name
 * and brand colour in every language, and the page's address and title in this one.
 */
export interface CarrierLink { id: string; catalog: string; slug: string; title: string; name: string; color: string }

export const CARRIER_LINKS: Record<Locale, readonly CarrierLink[]> = {
  "en": [
    {
      "id": "quickpac",
      "catalog": "quickpac",
      "slug": "quickpac-tracking",
      "title": "Quickpac tracking: find your parcel and what to do next",
      "name": "Quickpac",
      "color": "#ed1c24"
    },
    {
      "id": "planzer",
      "catalog": "planzer",
      "slug": "planzer-tracking",
      "title": "Planzer tracking: what each status means and what to do",
      "name": "Planzer",
      "color": "#e30613"
    },
    {
      "id": "colis-prive",
      "catalog": "colis-prive",
      "slug": "colis-prive-tracking",
      "title": "Colis Privé tracking: French statuses and what to do",
      "name": "Colis Privé",
      "color": "#aa78ff"
    },
    {
      "id": "brt",
      "catalog": "brt",
      "slug": "brt-tracking",
      "title": "BRT tracking: numbers, statuses and missed deliveries",
      "name": "BRT",
      "color": "#dc0032"
    },
    {
      "id": "correos-express",
      "catalog": "correos-express",
      "slug": "correos-express-tracking",
      "title": "Correos Express tracking: statuses in English and contact",
      "name": "Correos Express",
      "color": "#ffcd00"
    },
    {
      "id": "nacex",
      "catalog": "nacex",
      "slug": "nacex-tracking",
      "title": "NACEX tracking: number, statuses in English and contact",
      "name": "NACEX",
      "color": "#fe5000"
    },
    {
      "id": "yunexpress",
      "catalog": "yunexpress",
      "slug": "yunexpress-tracking",
      "title": "YunExpress tracking: YT numbers, statuses and who delivers",
      "name": "YunExpress",
      "color": "#008284"
    },
    {
      "id": "cainiao",
      "catalog": "aliexpress",
      "slug": "cainiao-tracking",
      "title": "Cainiao tracking: numbers, statuses and who to contact",
      "name": "Cainiao",
      "color": "#e62e04"
    }
  ],
  "de": [
    {
      "id": "quickpac",
      "catalog": "quickpac",
      "slug": "quickpac-tracking",
      "title": "Quickpac Tracking: Paket verfolgen und Status verstehen",
      "name": "Quickpac",
      "color": "#ed1c24"
    },
    {
      "id": "planzer",
      "catalog": "planzer",
      "slug": "planzer-sendungsverfolgung",
      "title": "Planzer Sendungsverfolgung: Status, Zustellung und Hilfe",
      "name": "Planzer",
      "color": "#e30613"
    },
    {
      "id": "yunexpress",
      "catalog": "yunexpress",
      "slug": "yunexpress-sendungsverfolgung",
      "title": "YunExpress Sendungsverfolgung: Status, Zusteller, Kontakt",
      "name": "YunExpress",
      "color": "#008284"
    },
    {
      "id": "cainiao",
      "catalog": "aliexpress",
      "slug": "cainiao-sendungsverfolgung",
      "title": "Cainiao Sendungsverfolgung: Nummern, Status und Kontakt",
      "name": "Cainiao",
      "color": "#e62e04"
    }
  ],
  "fr": [
    {
      "id": "quickpac",
      "catalog": "quickpac",
      "slug": "quickpac-tracking",
      "title": "Quickpac tracking\u00a0: suivi du colis, statuts et contact",
      "name": "Quickpac",
      "color": "#ed1c24"
    },
    {
      "id": "planzer",
      "catalog": "planzer",
      "slug": "planzer-suivi-colis",
      "title": "Planzer suivi colis\u00a0: statuts, livraison et contact",
      "name": "Planzer",
      "color": "#e30613"
    },
    {
      "id": "colis-prive",
      "catalog": "colis-prive",
      "slug": "suivi-colis-prive",
      "title": "Colis Privé suivi\u00a0: statuts, relais et service client",
      "name": "Colis Privé",
      "color": "#aa78ff"
    },
    {
      "id": "yunexpress",
      "catalog": "yunexpress",
      "slug": "yunexpress-suivi",
      "title": "YunExpress suivi\u00a0: numéro YT, statuts et qui livre",
      "name": "YunExpress",
      "color": "#008284"
    },
    {
      "id": "cainiao",
      "catalog": "aliexpress",
      "slug": "cainiao-suivi",
      "title": "Cainiao suivi\u00a0: numéros, statuts et qui contacter",
      "name": "Cainiao",
      "color": "#e62e04"
    }
  ],
  "it": [
    {
      "id": "quickpac",
      "catalog": "quickpac",
      "slug": "quickpac-tracking",
      "title": "Quickpac tracking: segui il pacco e capisci gli stati",
      "name": "Quickpac",
      "color": "#ed1c24"
    },
    {
      "id": "planzer",
      "catalog": "planzer",
      "slug": "planzer-tracking",
      "title": "Planzer tracking: stati del pacco, ritiro e contatti",
      "name": "Planzer",
      "color": "#e30613"
    },
    {
      "id": "brt",
      "catalog": "brt",
      "slug": "brt-tracking",
      "title": "BRT tracking: dov'è il pacco e cosa fare se non arriva",
      "name": "BRT",
      "color": "#dc0032"
    },
    {
      "id": "yunexpress",
      "catalog": "yunexpress",
      "slug": "yunexpress-tracking",
      "title": "YunExpress tracking: stati, consegna in Italia e contatti",
      "name": "YunExpress",
      "color": "#008284"
    },
    {
      "id": "cainiao",
      "catalog": "aliexpress",
      "slug": "cainiao-tracking",
      "title": "Cainiao tracking: numero, stati e pacco che non arriva",
      "name": "Cainiao",
      "color": "#e62e04"
    }
  ],
  "es": [
    {
      "id": "correos-express",
      "catalog": "correos-express",
      "slug": "correos-express-seguimiento",
      "title": "Correos Express seguimiento: estados, entrega y teléfono",
      "name": "Correos Express",
      "color": "#ffcd00"
    },
    {
      "id": "nacex",
      "catalog": "nacex",
      "slug": "seguimiento-nacex",
      "title": "NACEX seguimiento: número de envío, estados y teléfono",
      "name": "NACEX",
      "color": "#fe5000"
    },
    {
      "id": "yunexpress",
      "catalog": "yunexpress",
      "slug": "yunexpress-seguimiento",
      "title": "YunExpress seguimiento: estados, quién entrega y contacto",
      "name": "YunExpress",
      "color": "#008284"
    },
    {
      "id": "cainiao",
      "catalog": "aliexpress",
      "slug": "cainiao-seguimiento",
      "title": "Cainiao seguimiento en España: estados, entregas y teléfono",
      "name": "Cainiao",
      "color": "#e62e04"
    }
  ],
  "pt": [
    {
      "id": "correos-express",
      "catalog": "correos-express",
      "slug": "correos-express-rastreio",
      "title": "Correos Express rastreio: estados, entregas e contacto",
      "name": "Correos Express",
      "color": "#ffcd00"
    },
    {
      "id": "nacex",
      "catalog": "nacex",
      "slug": "nacex-rastreio",
      "title": "NACEX rastreio: código, estados e contacto em Portugal",
      "name": "NACEX",
      "color": "#fe5000"
    },
    {
      "id": "yunexpress",
      "catalog": "yunexpress",
      "slug": "yunexpress-rastreio",
      "title": "YunExpress rastreio: código YT, estados e contactos",
      "name": "YunExpress",
      "color": "#008284"
    },
    {
      "id": "cainiao",
      "catalog": "aliexpress",
      "slug": "cainiao-rastreio",
      "title": "Cainiao rastreio: números, estados e contactos em Portugal",
      "name": "Cainiao",
      "color": "#e62e04"
    }
  ],
  "pl": [
    {
      "id": "yunexpress",
      "catalog": "yunexpress",
      "slug": "yunexpress-sledzenie",
      "title": "YunExpress śledzenie przesyłki: statusy, kurier, kontakt",
      "name": "YunExpress",
      "color": "#008284"
    },
    {
      "id": "cainiao",
      "catalog": "aliexpress",
      "slug": "cainiao-sledzenie",
      "title": "Cainiao śledzenie przesyłki: numery, statusy i kontakt",
      "name": "Cainiao",
      "color": "#e62e04"
    }
  ]
};
