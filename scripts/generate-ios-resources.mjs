import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { nativeLocalizationReferences } from './native-localization.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'src', 'i18n.tsx');
const sourceText = fs.readFileSync(sourcePath, 'utf8');
const source = ts.createSourceFile(
  sourcePath,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const objects = new Map();
const directKeys = new Map();

// Copy that exists only in the native shell still belongs in the generated
// catalog. Keeping it here means the checked-in resource remains reproducible
// from the web catalog instead of becoming a second hand-maintained file.
const nativeMessages = {
  en: {
    'native.account': 'Account',
    'native.apnsTokenError': "Couldn’t connect this iPhone for alerts. Try again in Notification settings.",
    'native.auth.cancelled': 'Sign-in was cancelled.',
    'native.auth.invalidResponse': "Couldn’t complete sign-in. Please try again.",
    'native.auth.missingSession': "Couldn’t sign you in. Request a new code and try again.",
    'native.auth.notConfigured': "Sign-in is unavailable in this version.",
    'native.auth.requestFailed': "Couldn’t sign you in. Please try again.",
    'native.auth.saveSession': "Couldn’t save your sign-in on this iPhone. Please try again.",
    'native.auth.secureRequest': "Couldn’t start sign-in. Please try again.",
    'native.configurationHelp': "You can explore the app with demo parcels while sign-in is unavailable.",
    'native.deliveries': 'Deliveries',
    'native.deliveryProgress': 'Delivery progress',
    'native.done': 'Done',
    'native.error.authenticationExpired': 'Your sign-in expired. Please sign in again.',
    'native.error.duplicateTracking': "You’re already tracking this parcel.",
    'native.error.invalidResponse': "Couldn’t load the latest information. Please try again.",
    'native.error.labelTooLong': 'Parcel names can be at most 80 characters.',
    'native.error.refreshFailed': "Couldn’t get an update. We’ll try again automatically.",
    'native.error.refreshTimeout': "The carrier is taking longer to respond. Your tracking will update when it’s ready.",
    'native.error.rateLimited': "Please wait a moment before trying again.",
    'native.error.serviceFailed': "The service is temporarily unavailable. Please try again later.",
    'native.errorTitle': 'Something went wrong',
    'native.latest': 'Latest',
    'native.notificationsDenied': "Allow notifications in iPhone Settings to receive parcel alerts.",
    'native.openSettings': 'Open iPhone Settings',
    'native.parcelMissing': 'This parcel is no longer in your delivery box.',
    'native.resetDemo': 'Reset demo data',
    'onboarding.notifications.connectionError': "Alerts are allowed, but we couldn’t finish setting them up. You can try again in Notification settings.",
    'onboarding.notifications.continue': 'Continue to my parcels',
    'onboarding.notifications.enable': 'Enable notifications',
    'onboarding.notifications.enabledSubtitle': 'This iPhone is ready to receive the delivery updates you chose.',
    'onboarding.notifications.enabledTitle': 'Parcel alerts are ready',
    'onboarding.notifications.enabling': 'Enabling alerts…',
    'onboarding.notifications.eyebrow': 'One last choice',
    'onboarding.notifications.feature.delivery': 'Know when a parcel is out for delivery',
    'onboarding.notifications.feature.issues': "Know about customs checks and missed deliveries",
    'onboarding.notifications.feature.pickup': "Know when your parcel is ready to collect",
    'onboarding.notifications.fineTune': 'You stay in control. Fine-tune updates and quiet hours anytime in Notification Settings.',
    'onboarding.notifications.notNow': 'Not now',
    'onboarding.notifications.subtitle': "Choose the delivery updates you’d like to receive. You can change this anytime.",
    'onboarding.notifications.title': "Stay up to date with your parcels",
    'welcome.back': 'Back',
    'welcome.demo': 'Try the demo',
    'welcome.demoDescription': 'Demo parcels stay on this iPhone and do not require an account.',
    'welcome.feature.alerts': 'Get timely alerts for important delivery updates',
    'welcome.feature.private': 'Keep tracking numbers and history private to your account',
    'welcome.feature.track': 'Follow every parcel from announcement to arrival',
    'welcome.signIn': "Sign in to see my parcels",
    'welcome.signInInstead': 'Sign in instead',
    'welcome.subtitle': 'Track French and Swiss deliveries on the web and this iPhone.',
    'welcome.title': 'All your parcels in one place',
    'liveActivity.settingDescription': 'Automatically show parcels while they are out for delivery on the Lock Screen and Dynamic Island.',
    'liveActivity.settingTitle': 'Live Activities',
    'liveActivity.systemDisabled': 'Live Activities are disabled for this app in iPhone Settings.',
    'widget.disabledDescription': 'Enable Home Screen widget sharing in Account settings to see your next delivery.',
    'widget.disabledTitle': 'Widget turned off',
    'widget.galleryDescription': 'See out-for-delivery parcels and your next arrival at a glance.',
    'widget.galleryName': 'Next delivery',
    'widget.settingDescription': "Show your next deliveries in the Home Screen widgets you add.",
    'widget.settingTitle': 'Home Screen widgets',
  },
  de: {
    'native.account': 'Konto',
    'native.apnsTokenError': "Dieses iPhone konnte nicht für Meldungen verbunden werden. Versuche es in den Meldungseinstellungen erneut.",
    'native.auth.cancelled': 'Die Anmeldung wurde abgebrochen.',
    'native.auth.invalidResponse': "Die Anmeldung konnte nicht abgeschlossen werden. Versuche es erneut.",
    'native.auth.missingSession': "Die Anmeldung hat nicht geklappt. Fordere einen neuen Code an.",
    'native.auth.notConfigured': "Die Anmeldung ist in dieser Version nicht verfügbar.",
    'native.auth.requestFailed': "Die Anmeldung hat nicht geklappt. Versuche es erneut.",
    'native.auth.saveSession': "Deine Anmeldung konnte auf diesem iPhone nicht gespeichert werden. Versuche es erneut.",
    'native.auth.secureRequest': "Die Anmeldung konnte nicht gestartet werden. Versuche es erneut.",
    'native.configurationHelp': "Solange die Anmeldung nicht verfügbar ist, kannst du die App mit Demopaketen erkunden.",
    'native.deliveries': 'Sendungen',
    'native.deliveryProgress': 'Zustellfortschritt',
    'native.done': 'Fertig',
    'native.error.authenticationExpired': 'Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.',
    'native.error.duplicateTracking': "Du verfolgst dieses Paket bereits.",
    'native.error.invalidResponse': "Die neuesten Informationen konnten nicht geladen werden. Versuche es erneut.",
    'native.error.labelTooLong': 'Paketnamen dürfen höchstens 80 Zeichen lang sein.',
    'native.error.refreshFailed': "Eine Aktualisierung ist nicht verfügbar. Wir versuchen es automatisch erneut.",
    'native.error.refreshTimeout': "Der Paketdienst braucht länger für die Antwort. Dein Tracking wird aktualisiert, sobald sie vorliegt.",
    'native.error.rateLimited': "Warte bitte einen Moment und versuche es erneut.",
    'native.error.serviceFailed': "Der Dienst ist vorübergehend nicht verfügbar. Versuche es später erneut.",
    'native.errorTitle': 'Etwas ist schiefgelaufen',
    'native.latest': 'Neueste',
    'native.notificationsDenied': "Erlaube Mitteilungen in den iPhone-Einstellungen, um Paketmeldungen zu erhalten.",
    'native.openSettings': 'iPhone-Einstellungen öffnen',
    'native.parcelMissing': 'Dieses Paket befindet sich nicht mehr in deiner Paketübersicht.',
    'native.resetDemo': 'Demodaten zurücksetzen',
    'onboarding.notifications.connectionError': "Meldungen sind erlaubt, aber die Einrichtung konnte nicht abgeschlossen werden. Versuche es in den Meldungseinstellungen erneut.",
    'onboarding.notifications.continue': 'Weiter zu meinen Paketen',
    'onboarding.notifications.enable': 'Benachrichtigungen aktivieren',
    'onboarding.notifications.enabledSubtitle': 'Dieses iPhone ist bereit, deine ausgewählten Sendungsupdates zu empfangen.',
    'onboarding.notifications.enabledTitle': 'Paketmeldungen sind bereit',
    'onboarding.notifications.enabling': 'Meldungen werden aktiviert…',
    'onboarding.notifications.eyebrow': 'Eine letzte Wahl',
    'onboarding.notifications.feature.delivery': 'Erfahre, wenn ein Paket in Zustellung ist',
    'onboarding.notifications.feature.issues': "Erfahre von Zollprüfungen und verpassten Zustellungen",
    'onboarding.notifications.feature.pickup': "Erfahre, wann dein Paket abholbereit ist",
    'onboarding.notifications.fineTune': 'Du behältst die Kontrolle. Updates und Ruhezeiten kannst du jederzeit in den Benachrichtigungseinstellungen anpassen.',
    'onboarding.notifications.notNow': 'Nicht jetzt',
    'onboarding.notifications.subtitle': "Wähle die Liefermeldungen, die du erhalten möchtest. Du kannst das jederzeit ändern.",
    'onboarding.notifications.title': "Bleib über deine Pakete informiert",
    'welcome.back': 'Zurück',
    'welcome.demo': 'Demo ausprobieren',
    'welcome.demoDescription': 'Demopakete bleiben auf diesem iPhone und benötigen kein Konto.',
    'welcome.feature.alerts': 'Erhalte rechtzeitig Meldungen zu wichtigen Lieferupdates',
    'welcome.feature.private': 'Sendungsnummern und Verlauf bleiben in deinem Konto privat',
    'welcome.feature.track': 'Verfolge jedes Paket von der Ankündigung bis zur Ankunft',
    'welcome.signIn': "Anmelden und meine Pakete sehen",
    'welcome.signInInstead': 'Stattdessen anmelden',
    'welcome.subtitle': 'Verfolge französische und Schweizer Lieferungen im Web und auf diesem iPhone.',
    'welcome.title': 'Alle deine Pakete an einem Ort',
    'liveActivity.settingDescription': 'Zeige Pakete automatisch auf dem Sperrbildschirm und in der Dynamic Island, während sie in Zustellung sind.',
    'liveActivity.settingTitle': 'Live-Aktivitäten',
    'liveActivity.systemDisabled': 'Live-Aktivitäten sind für diese App in den iPhone-Einstellungen deaktiviert.',
    'widget.disabledDescription': 'Aktiviere die Freigabe für Home-Bildschirm-Widgets in den Kontoeinstellungen, um deine nächste Lieferung zu sehen.',
    'widget.disabledTitle': 'Widget ausgeschaltet',
    'widget.galleryDescription': 'Pakete in Zustellung und deine nächste Sendung auf einen Blick.',
    'widget.galleryName': 'Nächste Lieferung',
    'widget.settingDescription': "Zeige deine nächsten Lieferungen in deinen Home-Bildschirm-Widgets.",
    'widget.settingTitle': 'Home-Bildschirm-Widgets',
  },
  fr: {
    'native.account': 'Compte',
    'native.apnsTokenError': "Impossible de connecter cet iPhone aux alertes. Réessayez dans les réglages des notifications.",
    'native.auth.cancelled': 'La connexion a été annulée.',
    'native.auth.invalidResponse': "Impossible de terminer la connexion. Réessayez.",
    'native.auth.missingSession': "La connexion a échoué. Demandez un nouveau code et réessayez.",
    'native.auth.notConfigured': "La connexion est indisponible dans cette version.",
    'native.auth.requestFailed': "La connexion a échoué. Veuillez réessayer.",
    'native.auth.saveSession': "Impossible d’enregistrer votre connexion sur cet iPhone. Réessayez.",
    'native.auth.secureRequest': "Impossible de démarrer la connexion. Réessayez.",
    'native.configurationHelp': "Vous pouvez découvrir l’app avec les colis de démonstration en attendant.",
    'native.deliveries': 'Livraisons',
    'native.deliveryProgress': 'Progression de la livraison',
    'native.done': 'Terminé',
    'native.error.authenticationExpired': 'Votre connexion a expiré. Veuillez vous reconnecter.',
    'native.error.duplicateTracking': "Vous suivez déjà ce colis.",
    'native.error.invalidResponse': "Impossible de charger les dernières informations. Réessayez.",
    'native.error.labelTooLong': 'Le nom d’un colis ne peut pas dépasser 80 caractères.',
    'native.error.refreshFailed': "Impossible d’obtenir une mise à jour. Nous réessaierons automatiquement.",
    'native.error.refreshTimeout': "Le transporteur met plus de temps à répondre. Le suivi sera actualisé dès que possible.",
    'native.error.rateLimited': "Patientez un instant avant de réessayer.",
    'native.error.serviceFailed': "Le service est momentanément indisponible. Réessayez plus tard.",
    'native.errorTitle': 'Un problème est survenu',
    'native.latest': 'Dernier',
    'native.notificationsDenied': "Autorisez les notifications dans les réglages iPhone pour recevoir les alertes colis.",
    'native.openSettings': 'Ouvrir les réglages iPhone',
    'native.parcelMissing': 'Ce colis ne se trouve plus dans votre liste de livraisons.',
    'native.resetDemo': 'Réinitialiser les données de démo',
    'onboarding.notifications.connectionError': "Les alertes sont autorisées, mais leur configuration a échoué. Réessayez dans les réglages des notifications.",
    'onboarding.notifications.continue': 'Voir mes colis',
    'onboarding.notifications.enable': 'Activer les notifications',
    'onboarding.notifications.enabledSubtitle': 'Cet iPhone est prêt à recevoir les mises à jour de livraison que vous avez choisies.',
    'onboarding.notifications.enabledTitle': 'Les alertes colis sont prêtes',
    'onboarding.notifications.enabling': 'Activation des alertes…',
    'onboarding.notifications.eyebrow': 'Un dernier choix',
    'onboarding.notifications.feature.delivery': 'Savoir quand un colis est en livraison',
    'onboarding.notifications.feature.issues': "Soyez informé des contrôles douaniers et des livraisons manquées",
    'onboarding.notifications.feature.pickup': "Sachez quand votre colis est prêt à être retiré",
    'onboarding.notifications.fineTune': 'Vous gardez le contrôle. Ajustez les alertes et les heures silencieuses à tout moment dans les réglages des notifications.',
    'onboarding.notifications.notNow': 'Pas maintenant',
    'onboarding.notifications.subtitle': "Choisissez les nouvelles de livraison que vous souhaitez recevoir. Vous pourrez changer d’avis à tout moment.",
    'onboarding.notifications.title': "Gardez un œil sur vos colis",
    'welcome.back': 'Retour',
    'welcome.demo': 'Essayer la démo',
    'welcome.demoDescription': 'Les colis de démonstration restent sur cet iPhone et ne nécessitent aucun compte.',
    'welcome.feature.alerts': 'Recevez à temps les alertes de livraison importantes',
    'welcome.feature.private': 'Gardez vos numéros de suivi et votre historique privés',
    'welcome.feature.track': 'Suivez chaque colis de son annonce à son arrivée',
    'welcome.signIn': "Me connecter pour voir mes colis",
    'welcome.signInInstead': 'Se connecter à la place',
    'welcome.subtitle': 'Suivez vos livraisons françaises et suisses sur le web et sur cet iPhone.',
    'welcome.title': 'Tous vos colis au même endroit',
    'liveActivity.settingDescription': 'Affiche automatiquement les colis sur l’écran verrouillé et dans la Dynamic Island pendant leur livraison.',
    'liveActivity.settingTitle': 'Activités en direct',
    'liveActivity.systemDisabled': 'Les activités en direct sont désactivées pour cette app dans les réglages de l’iPhone.',
    'widget.disabledDescription': 'Activez le partage des widgets d’écran d’accueil dans les réglages du compte pour voir votre prochaine livraison.',
    'widget.disabledTitle': 'Widget désactivé',
    'widget.galleryDescription': 'Consultez les colis en livraison et votre prochaine arrivée en un coup d’œil.',
    'widget.galleryName': 'Prochaine livraison',
    'widget.settingDescription': "Affichez vos prochaines livraisons dans les widgets de l’écran d’accueil.",
    'widget.settingTitle': 'Widgets d’écran d’accueil',
  },
  it: {
    'native.account': 'Account',
    'native.apnsTokenError': "Impossibile collegare questo iPhone agli avvisi. Riprova nelle impostazioni delle notifiche.",
    'native.auth.cancelled': 'L’accesso è stato annullato.',
    'native.auth.invalidResponse': "Impossibile completare l’accesso. Riprova.",
    'native.auth.missingSession': "Accesso non riuscito. Richiedi un nuovo codice e riprova.",
    'native.auth.notConfigured': "L’accesso non è disponibile in questa versione.",
    'native.auth.requestFailed': "Accesso non riuscito. Riprova.",
    'native.auth.saveSession': "Impossibile salvare l’accesso su questo iPhone. Riprova.",
    'native.auth.secureRequest': "Impossibile avviare l’accesso. Riprova.",
    'native.configurationHelp': "Nel frattempo puoi esplorare l’app con i pacchi di esempio.",
    'native.deliveries': 'Consegne',
    'native.deliveryProgress': 'Avanzamento della consegna',
    'native.done': 'Fine',
    'native.error.authenticationExpired': 'La sessione è scaduta. Accedi di nuovo.',
    'native.error.duplicateTracking': "Stai già seguendo questo pacco.",
    'native.error.invalidResponse': "Impossibile caricare le ultime informazioni. Riprova.",
    'native.error.labelTooLong': 'I nomi dei pacchi possono contenere al massimo 80 caratteri.',
    'native.error.refreshFailed': "Impossibile ottenere un aggiornamento. Riproveremo automaticamente.",
    'native.error.refreshTimeout': "Il corriere sta impiegando più tempo a rispondere. Il tracciamento si aggiornerà appena possibile.",
    'native.error.rateLimited': "Attendi un momento prima di riprovare.",
    'native.error.serviceFailed': "Il servizio non è al momento disponibile. Riprova più tardi.",
    'native.errorTitle': 'Qualcosa è andato storto',
    'native.latest': 'Più recente',
    'native.notificationsDenied': "Consenti le notifiche nelle impostazioni iPhone per ricevere gli avvisi sui pacchi.",
    'native.openSettings': 'Apri le impostazioni iPhone',
    'native.parcelMissing': 'Questo pacco non è più presente nell’elenco delle consegne.',
    'native.resetDemo': 'Reimposta i dati demo',
    'onboarding.notifications.connectionError': "Gli avvisi sono consentiti, ma la configurazione non è stata completata. Riprova nelle impostazioni delle notifiche.",
    'onboarding.notifications.continue': 'Vai ai miei pacchi',
    'onboarding.notifications.enable': 'Attiva le notifiche',
    'onboarding.notifications.enabledSubtitle': 'Questo iPhone è pronto a ricevere gli aggiornamenti di consegna che hai scelto.',
    'onboarding.notifications.enabledTitle': 'Gli avvisi sui pacchi sono pronti',
    'onboarding.notifications.enabling': 'Attivazione avvisi…',
    'onboarding.notifications.eyebrow': 'Un’ultima scelta',
    'onboarding.notifications.feature.delivery': 'Scopri quando un pacco è in consegna',
    'onboarding.notifications.feature.issues': "Scopri i controlli doganali e le consegne non riuscite",
    'onboarding.notifications.feature.pickup': "Scopri quando il pacco è pronto per il ritiro",
    'onboarding.notifications.fineTune': 'Hai sempre il controllo. Modifica aggiornamenti e ore silenziose in qualsiasi momento nelle impostazioni delle notifiche.',
    'onboarding.notifications.notNow': 'Non ora',
    'onboarding.notifications.subtitle': "Scegli quali aggiornamenti ricevere. Puoi cambiare le preferenze in qualsiasi momento.",
    'onboarding.notifications.title': "Resta aggiornato sui tuoi pacchi",
    'welcome.back': 'Indietro',
    'welcome.demo': 'Prova la demo',
    'welcome.demoDescription': 'I pacchi demo restano su questo iPhone e non richiedono un account.',
    'welcome.feature.alerts': 'Ricevi avvisi tempestivi sugli aggiornamenti importanti',
    'welcome.feature.private': 'Mantieni privati numeri di tracciamento e cronologia',
    'welcome.feature.track': 'Segui ogni pacco dall’annuncio all’arrivo',
    'welcome.signIn': "Accedi per vedere i tuoi pacchi",
    'welcome.signInInstead': 'Accedi invece',
    'welcome.subtitle': 'Segui le consegne francesi e svizzere sul web e su questo iPhone.',
    'welcome.title': 'Tutti i tuoi pacchi in un unico posto',
    'liveActivity.settingDescription': 'Mostra automaticamente i pacchi nella schermata di blocco e nella Dynamic Island mentre sono in consegna.',
    'liveActivity.settingTitle': 'Attività in tempo reale',
    'liveActivity.systemDisabled': 'Le attività in tempo reale sono disattivate per questa app nelle impostazioni di iPhone.',
    'widget.disabledDescription': 'Attiva la condivisione dei widget della schermata Home nelle impostazioni dell’account per vedere la prossima consegna.',
    'widget.disabledTitle': 'Widget disattivato',
    'widget.galleryDescription': 'Controlla i pacchi in consegna e il prossimo arrivo a colpo d’occhio.',
    'widget.galleryName': 'Prossima consegna',
    'widget.settingDescription': "Mostra le prossime consegne nei widget della schermata Home.",
    'widget.settingTitle': 'Widget schermata Home',
  },
};

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  throw new Error(`Unsupported localization property at ${node.pos}`);
}

function stringValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  throw new Error(`Localization value must be a string at ${node.pos}`);
}

function evaluateObject(node) {
  const result = {};
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      if (!ts.isIdentifier(property.expression)) {
        throw new Error(`Unsupported localization spread at ${property.pos}`);
      }
      Object.assign(result, objects.get(property.expression.text));
      continue;
    }
    if (ts.isPropertyAssignment(property)) {
      result[propertyName(property.name)] = stringValue(property.initializer);
    }
  }
  return result;
}

for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
    if (!['en', 'de', 'fr', 'it'].includes(declaration.name.text)) continue;
    const expression = ts.isAsExpression(declaration.initializer)
      ? declaration.initializer.expression
      : declaration.initializer;
    if (ts.isObjectLiteralExpression(expression)) {
      objects.set(declaration.name.text, evaluateObject(expression));
      directKeys.set(
        declaration.name.text,
        new Set(expression.properties.filter(ts.isPropertyAssignment).map((property) =>
          propertyName(property.name))),
      );
    }
  }
}

const englishWebKeys = directKeys.get('en');
if (!englishWebKeys) throw new Error('Missing English localization catalog');
for (const code of ['de', 'fr', 'it']) {
  const keys = directKeys.get(code);
  if (!keys) throw new Error(`Missing ${code} localization catalog`);
  const missing = [...englishWebKeys].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !englishWebKeys.has(key));
  if (missing.length || extra.length) {
    throw new Error(
      `${code} must define every web translation directly. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.`,
    );
  }
}

const englishNativeKeys = new Set(Object.keys(nativeMessages.en));
for (const code of ['de', 'fr', 'it']) {
  const keys = new Set(Object.keys(nativeMessages[code]));
  const missing = [...englishNativeKeys].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !englishNativeKeys.has(key));
  if (missing.length || extra.length) {
    throw new Error(
      `${code} native copy does not match English. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.`,
    );
  }
}

const languages = Object.fromEntries(
  ['en', 'de', 'fr', 'it'].map((code) => {
    const messages = objects.get(code);
    if (!messages) throw new Error(`Missing ${code} localization catalog`);
    const merged = { ...messages, ...nativeMessages[code] };
    return [code, Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)))];
  }),
);

const variables = (value) => [...value.matchAll(/\{\{([A-Za-z0-9_.-]+)\}\}/g)]
  .map((match) => match[1]).sort().join(',');
for (const code of ['de', 'fr', 'it']) {
  for (const [key, value] of Object.entries(languages.en)) {
    if (variables(value) !== variables(languages[code][key])) {
      throw new Error(`${code}.${key} must preserve the English interpolation variables`);
    }
  }
}

const swiftSources = ['SwissDeliveryTracker', 'DeliveryWidgetExtension']
  .flatMap((directory) => fs.readdirSync(path.join(root, 'ios', directory))
    .filter((name) => name.endsWith('.swift'))
    .map((name) => fs.readFileSync(path.join(root, 'ios', directory, name), 'utf8')))
  .join('\n');
const referencedKeys = nativeLocalizationReferences(swiftSources, Object.keys(languages.en));
const missingNativeReferences = [...referencedKeys].filter((key) => !(key in languages.en));
if (missingNativeReferences.length) {
  throw new Error(
    `Native localization references are missing from the generated catalog: ${missingNativeReferences.sort().join(', ')}`,
  );
}

const resources = path.join(root, 'ios', 'SwissDeliveryTracker', 'Resources');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'openapi.json'), 'utf8'));
const apiFixture = JSON.parse(fs.readFileSync(
  path.join(root, 'contracts', 'fixtures', 'delivery-api.json'),
  'utf8',
));
const outputs = new Map([
  ['Localization.json', `${JSON.stringify(languages, null, 2)}\n`],
  ['CarrierCatalog.json', `${JSON.stringify({ 'x-carriers': contract['x-carriers'] }, null, 2)}\n`],
  ['ContractFixtures.json', `${JSON.stringify(apiFixture, null, 2)}\n`],
]);

if (process.argv.includes('--check')) {
  const stale = [...outputs].flatMap(([name, expected]) => {
    const target = path.join(resources, name);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    return current === expected ? [] : [path.relative(root, target)];
  });
  if (stale.length) {
    throw new Error(`Generated iOS resources are stale: ${stale.join(', ')}. Run npm run ios:resources.`);
  }
  console.log('Generated iOS resources are current.');
} else {
  fs.mkdirSync(resources, { recursive: true });
  for (const [name, contents] of outputs) {
    fs.writeFileSync(path.join(resources, name), contents);
  }
  console.log(`Generated iOS resources for ${Object.keys(languages).length} languages and ${Object.keys(contract['x-carriers']).length} carriers.`);
}
