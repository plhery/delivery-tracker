---
title: Stati della spedizione: cosa significano, uno per uno
description: Da «etichetta creata» a «consegnato»: cosa vuol dire ogni stato del tracking, in ordine, con gli esempi di Poste, BRT, UPS e La Posta, e quando tocca a te.
slug: stati-spedizione-cosa-significano
picture: Un percorso tortuoso con tappe spuntate (etichetta, deposito, aereo), un furgone alla tappa attuale, una casa ancora davanti e Pip che corre.
published: 2026-10-09
updated: 2026-10-09
---

Uno stato della spedizione è l'ultima scansione del corriere riassunta in poche parole, e quasi sempre non ti chiede niente. «Etichetta creata» vuol dire che il corriere il pacco non ce l'ha ancora, «in transito» che è da qualche parte tra due scansioni, «in consegna» che è sul furgone di oggi. Solo pochi stati ti chiedono di fare qualcosa: una mancata consegna, un pacco in giacenza da ritirare, qualcosa da pagare in dogana e un «consegnato» quando alla porta non c'è niente.

## Quali sono le fasi di una spedizione?

Ogni pacco passa dalle stesse tappe; se arriva dall'estero, se ne aggiungono tre.

:::journey
- label | Etichetta creata | Il corriere ha i dati, non il pacco.
- warehouse | In transito | Ritirato, poi da un hub all'altro, con lunghi silenzi.
- plane | Partito dal Paese | Solo dall'estero. In volo niente scansioni.
- customs | Dogana | Solo dall'estero. A volte c'è da pagare.
- handover | Corriere locale | Solo dall'estero. Le sue scansioni a volte si vedono solo sul suo sito.
- truck | In consegna | Sul furgone di oggi.
- locker | Pronto per il ritiro | In un ufficio postale, un negozio o un locker.
- home | Consegnato | Dato in mano, o lasciato dove per il corriere vale come consegna.
:::

## Cosa vogliono dire gli stati di Poste, UPS e La Posta?

Stesse tappe, parole diverse:

| Fase | Poste Italiane | UPS | La Posta (Svizzera) |
| --- | --- | --- | --- |
| Etichetta creata | `Tracciatura non disponibile` (codice appena creato) | `Etichetta creata` | `Notifica dell'invio da parte dello speditore (inoltro dei dati)` |
| Preso in carico | `Presa in carico` | `Spedito/In transito` | `Momento dell'impostazione del proprio invio` |
| In transito | `In transito` | `Spedito/In transito` | `L'invio è stato spartito e inoltrato` |
| In consegna | `In consegna` | `In consegna` | `L'invio è stato spartito per il recapito` (smistato verso la tua località) |
| Pronto per il ritiro | Può restare `In consegna` | `Consegnato a una sede UPS Access Point` | `Arrivo al punto di ritiro / ufficio di recapito` |
| Consegnato | `la spedizione è stata consegnata` | `Consegnato` | `Recapitato da` |

## «Etichetta creata»: il corriere ha già il pacco?

No: il venditore ha stampato un'etichetta e mandato i dati al corriere, niente di più. FedEx lo dice chiaro: con `Etichetta creata` il mittente sta ancora preparando il collo, e lo stato si aggiorna quando il collo arriva a FedEx. UPS cambia il suo `Etichetta creata` solo quando ha il pacco e lo ha messo in viaggio nella sua rete. Per la Posta svizzera, con `Notifica dell'invio da parte dello speditore (inoltro dei dati)` il mittente ha generato il numero d'invio, ma di norma il pacco non è ancora alla Posta. Diciture come «spedizione generata, in attesa di ritiro» vogliono dire la stessa cosa.

Su Poste un codice appena creato dà `Tracciatura non disponibile`: Poste consiglia di riprovare dopo qualche ora. Se l'etichetta resta l'unica riga per giorni, scrivi al venditore, non al corriere: il pacco ce l'ha ancora lui.

## Cosa significa «in transito»?

Il corriere ha il tuo pacco, da qualche parte nella sua rete. Non vuol dire che si stia muovendo: per FedEx un collo `In transito` può essere su un veicolo in viaggio oppure fermo in una sua sede. Poste avverte che, per fare prima, il pacco può passare da tappe intermedie che sembrano fuori strada rispetto a partenza e arrivo.

Tra un hub e l'altro, il silenzio è normale:

- Su un tragitto lungo, UPS probabilmente non scansiona il pacco fino all'hub di destinazione.
- Per FedEx non è insolito passare più di 24 ore senza scansioni, soprattutto sulle tratte lunghe.
- In Germania, DHL avverte che uno stato di smistamento può restare uguale per ore o giorni mentre il pacco continua a viaggiare.

### Quanto resta in transito un pacco?

In Italia, di solito poco. L'obiettivo di Poste per il Poste Delivery Standard è la consegna entro 5 giorni lavorativi (sabato escluso) nel 90% dei casi; BRT (ex Bartolini) dichiara 1 o 2 giorni lavorativi per il 96% delle spedizioni. In Svizzera un PostPac Priority arriva di norma il giorno feriale successivo, un PostPac Economy entro due giorni lavorativi. Tra Paesi diversi ci vuole di più: per le spedizioni dall'Italia all'estero BRT dichiara da 2 a 10 giorni lavorativi nel 96% dei casi. Fermo da più tempo del previsto? Leggi [perché il tracking non si aggiorna](guide:tracking-not-updating).

## Pacchi dall'estero: partenza, dogana, corriere locale

- **Partito dal Paese.** Il pacco viaggia in aereo, in nave o in treno, e nel frattempo non lo scansiona nessuno. La Posta mostra `Arrivo alla frontiera del paese di destinazione`, e avverte che prima del recapito il pacco può dover passare dalla dogana. Può comparire anche `Termine di recapito sconosciuto`: per un invio che arriva dall'estero o ci va, la data non si può prevedere. Se invece spedisci tu con Poste Delivery International Standard, `In transito presso il Centro di lavorazione Internazionale` (il pacco ha lasciato l'Italia) è l'ultima traccia che vedrai.
- **Dogana.** Su Poste compare `In attesa di sdoganamento`: il pacco è sotto controllo doganale e potrebbero chiederti altri documenti. La Posta scrive `L'invio è stato consegnato alla dogana`, poi `Procedura di sdoganamento postale in corso`, infine `Autorizzato dalla dogana svizzera`, quando passa al recapito nazionale. DHL parla di alcuni giorni lavorativi, la Posta di tre o quattro giorni lavorativi se i dati sono completi e corretti; nessuno dei due dà un massimo. Muoviti solo se ti chiedono un documento o un pagamento; leggi [pacco fermo in dogana](guide:customs).
- **Corriere locale.** Diciture come «consegnato al corriere locale» o «in transito verso l'operatore dell'ultimo miglio» vogliono dire che l'ultimo tratto lo fa un'altra azienda. DHL ti rimanda al tracking del corriere del Paese di destinazione. Hai ordinato su AliExpress, Temu o Shein? Leggi [come tracciare un pacco dalla Cina](guide:tracking-from-china).

## «In consegna» vuol dire che arriva oggi?

Di solito sì:

- **Poste:** `In consegna` vuol dire che il pacco è stato affidato a chi lo consegna. Ma anche con questo stato, per Poste la data prevista è solo indicativa.
- **UPS:** salvo servizi con orario definito, a casa consegna di solito tra le 9 e le 19, a volte più tardi.
- **FedEx:** il collo è stato caricato su un veicolo per la consegna in giornata; la fascia oraria stimata la trovi nella pagina di tracking.

Due diciture ingannano. Su Poste, `In consegna` può restare anche dopo che il pacco è stato consegnato, o quando ti aspetta già in un ufficio postale o in un Punto Poste; se la consegna non riesce, torna `In transito`. E `L'invio è stato spartito per il recapito` della Posta vuol dire che un centro l'ha smistato verso la tua località: non è detto che sia già sul furgone. Quanto a «fuori per la consegna», che si legge su alcuni tracking tradotti dall'inglese, è semplicemente «in consegna».

[Peek](/) ricontrolla un pacco in consegna fino a ogni 2 minuti, e il resto del percorso fino a ogni 10 minuti. Puoi impostare gli avvisi su «Solo giorno di consegna».

## Tentativo di consegna fallito o pacco in giacenza: cosa fare?

Questo stato invece ti chiede di muoverti: non c'era nessuno a ricevere il pacco, o il corriere non è riuscito a entrare. «In giacenza» vuol dire che ora il pacco aspetta in filiale o all'ufficio postale, finché lo ritiri o qualcuno decide cosa farne.

:::steps
- Leggi l'avviso | Cartaceo, SMS o e-mail: dice dov'è finito il pacco e ti dà un codice da usare.
- Controlla la scadenza | Da 7 a 15 giorni, contati in giorni di calendario o lavorativi: dipende dal corriere.
- Riprogramma o sposta | Sul sito o nell'app del corriere: un altro giorno, un vicino, un punto di ritiro.
- Ritira con un documento | Porta un documento d'identità e l'avviso. Per chi ritira al posto tuo di solito serve una delega.
:::

| Corriere | Dopo una mancata consegna | Quanto lo tengono |
| --- | --- | --- |
| Poste Delivery Standard | Due tentativi a domicilio, poi l'avviso di giacenza | 10 giorni lavorativi, sabato compreso; poi torna al mittente, salvo che abbia chiesto l'abbandono |
| Poste Delivery Express | Avviso di mancata consegna | 10 giorni lavorativi, sabato compreso; torna al mittente solo se l'ha chiesto, altrimenti è abbandonato |
| BRT | Avviso via e-mail, SMS o carta; secondo tentativo, poi la filiale ti telefona | In giacenza in filiale: torna indietro se il mittente non dà istruzioni scritte entro 10 giorni |
| GLS | «Avviso di passaggio»; primo e secondo tentativo | In giacenza alla sede GLS: la sua pagina non dice per quanto |
| UPS | Avviso UPS InfoNotice; fino a tre tentativi, o una sede UPS Access Point | 7 giorni all'Access Point, poi torna al mittente |
| Mondial Relay (Italia) | Il pacco è già indirizzato a un Point Relais o a un locker | 7 giorni, senza proroga; poi torna al mittente |
| La Posta (Svizzera) | Invito di ritiro | 7 giorni, 15 per i pacchi dall'estero; proroga gratuita, anche senza account |

Con BRT, il BRTcode lo trovi negli SMS, nelle e-mail o sul tagliando del corriere: con quello cambi data e fascia oraria, scegli un BRT-fermopoint o sblocchi la giacenza. Con la Posta, dopo il login a «I miei invii», puoi chiedere un secondo recapito (gratis se il pacco viene depositato o dato a un vicino, CHF 3.30 al piano, CHF 7.00 il sabato) o un inoltro (CHF 8.00 dal lunedì al venerdì). Hai perso l'avviso di Poste? Chiama il Servizio Clienti e il portalettere te ne porta un duplicato.

> Un SMS che parla di un pacco trattenuto e ti chiede di pagare da un link è il classico messaggio truffa. La Posta svizzera cita proprio «Pacco trattenuto presso il terminale» tra le frasi tipiche dei messaggi falsi, di solito seguita da una richiesta di pagamento. Poste Italiane ricorda che non ti chiederà mai, né via SMS né via e-mail, i dati della carta, i codici OTP o le credenziali. Controlla il pacco solo sul sito o nell'app del corriere, scrivendo tu l'indirizzo.

## «Disponibile per il ritiro»: dove si trova il pacco?

In un ufficio postale, in un punto di ritiro o in un locker, fino alla scadenza della tabella qui sopra. UPS lo segnala con `Consegnato a una sede UPS Access Point`; per la Posta il pacco è disponibile da quando compare `Arrivo al punto di ritiro / ufficio di recapito`.

Su Poste, invece, lo stato può restare `In consegna` anche se il pacco ti aspetta già in un ufficio postale, in un Punto Poste o in un Punto Poste Da Te. Se è all'ufficio postale, nel Cerca spedizioni compare il pulsante «Prenota»: scegli giorno e ora per ritirarlo, entro la giacenza.

Prima di uscire, controlla che sia davvero pronto. UPS chiede di verificare nel tracking che il pacco sia `In attesa di ritiro da parte del cliente`, dove trovi anche orari e mappa del punto, e di portare un documento d'identità con foto e il numero di tracking. Su Poste, l'avviso riporta la data da cui puoi ritirarlo.

## «Consegnato» vuol dire che ce l'hai tu?

Non sempre. Vuol dire che il corriere l'ha scansionato come consegnato o lasciato:

- **A qualcun altro.** Per le condizioni generali di Poste possono ricevere un invio al tuo domicilio anche i familiari, i conviventi, i collaboratori familiari e il portiere, se c'è. Con BRT puoi indicare tu un vicino a cui lasciarlo, purché abiti allo stesso indirizzo.
- **In un posto sicuro.** Se non serve una firma, UPS lascia il pacco in un luogo sicuro e protetto, come una porta laterale o l'area di un garage. Su ups.com/track puoi vedere una foto del punto esatto.
- **Nella cassetta o allo sportello.** La Posta distingue `Recapitato da` (a domicilio), `Recapitato nello scomparto di deposito / cassetta delle lettere` (la cassetta del latte) e `Recapitato allo sportello` (una filiale, una filiale in partenariato o un punto PickPost).

Non c'è niente? Cerca nel tracking una foto, un nome o un luogo, poi leggi [pacco consegnato ma non ricevuto](guide:delivered-not-received).

## «Eccezione di consegna»: il pacco è perso?

No. Per FedEx, `Eccezione di consegna` vuol dire che un imprevisto impedisce la consegna: ritardi doganali, maltempo, scioperi, destinatario non trovato o restrizioni di sicurezza. E aggiunge che non devi fare nulla. `Eccezione` di UPS vuol dire che un imprevisto potrebbe spostare la data di consegna: il motivo è in «Avanzamento spedizione», e quando la data cambia lo stato mostra quella nuova.

`In ritardo` di FedEx vuol dire che probabilmente il collo non arriverà entro la data stimata. La Posta ha `Ritardo` ed `Errore di avviamento`: per esempio, un numero postale di avviamento (il CAP svizzero) sbagliato manda il pacco all'ufficio sbagliato, e può esserci un ritardo, ma non è detto.

Guarda meglio quando c'entra l'indirizzo o un pagamento. BRT mette il pacco in giacenza se il destinatario è assente, sconosciuto o trasferito, se l'indirizzo è sbagliato o incompleto, o se la merce è stata rifiutata; puoi sbloccarla tu dal link dell'SMS o dell'e-mail, o con il BRTcode. La Posta segnala `Tentativo di recapito, indirizzo non corretto`.

## Perché il pacco è stato restituito al mittente?

I motivi dei corrieri: non ritirato in tempo, indirizzo sbagliato o incompleto, destinatario irreperibile, rifiuto, richiesta del mittente. Ognuno lo scrive a modo suo:

- **Poste** `Resa al mittente`: dal tracking segui il viaggio di ritorno con «Segui la spedizione di ritorno al mittente». Se poi non si riesce a restituirlo nemmeno al mittente, il pacco viene distrutto o dato in beneficenza.
- **La Posta** `Rinvio`, con il motivo: `Non ritirato`, `Respinto`, trasloco con l'ordine di rispedizione scaduto (di norma dopo un anno), destinatario irreperibile all'indirizzo indicato.
- **BRT:** un pacco in giacenza torna indietro dopo 10 giorni dall'avviso di giacenza mandato al mittente, se lui non dà istruzioni scritte.
- **Mondial Relay:** un pacco non ritirato entro 7 giorni torna in automatico al mittente.

A quel punto decide il venditore: chiedigli di rispedirtelo o di rimborsarti.

:::sources
- [Poste Italiane: Cerca spedizioni, legenda degli stati](https://www.poste.it/cerca/index.html) – Presa in carico, In transito, In consegna, sdoganamento, Centro di lavorazione Internazionale, Resa al mittente, Tracciatura non disponibile, data prevista indicativa
- [Poste Italiane: FAQ Spedizioni e Consegne](https://www.poste.it/assistenza/faq-spedizioni-e-consegne/) – giacenza di Poste Delivery Express e Standard, duplicato dell'avviso, «Prenota»
- [Poste Italiane: Carta del Servizio Postale Universale](https://www.media.poste.it/c919f7cf-8236-428e-82fc-f8b2be8428b8/web/carta-servizi-universali) – Poste Delivery Standard: due tentativi, giacenza, 90% in 5 giorni lavorativi
- [Poste Italiane: Condizioni generali del servizio postale](https://www.media.poste.it/404d312b-44e4-4a27-bace-a1741986ebc2/web/condizioni-generali-espletamento-servizio-postale-universale) – chi può ricevere al tuo domicilio (art. 27)
- [Poste Italiane: Come difendersi dalle truffe](https://www.poste.it/sicurezza-online/guide-per-operare-in-sicurezza/come-difendersi-dalle-truffe) – dati della carta, OTP e credenziali
- [BRT: Domande frequenti](https://www.brt.it/it/servizio-clienti/faq/) – BRTcode, nuova consegna, sblocco della giacenza
- [BRT: Ho la spedizione in giacenza, cosa significa?](https://www.brt.it/it/faq/ho-la-spedizione-in-giacenza-cosa-significa/) – motivi della giacenza
- [BRT: Carta dei Servizi](https://www.brt.it/wp-content/uploads/sites/275/2026/03/Carta-dei-Servizi_marzo_2026.pdf) – avviso, secondo tentativo, telefonata, consegna al vicino, 10 giorni, 96%
- [GLS: La consegna e le possibili opzioni](https://gls-group.com/IT/it/spedire-ricevere/opzioni-consegna/) – avviso di passaggio, due tentativi, giacenza in sede
- [UPS: Informazioni sullo stato del tracking](https://www.ups.com/it/it/support/tracking-support/where-is-my-package/understanding-tracking-status) – stati, orari, luogo sicuro, foto, eccezione
- [UPS: InfoNotice UPS](https://www.ups.com/it/it/support/tracking-support/where-is-my-package/how-to-use-infonotice) – tre tentativi, Access Point, 7 giorni, documento
- [FedEx: Cosa indica lo stato della spedizione?](https://www.fedex.com/it-it/customer-support/faq/receiving/tracking-questions/fedex-tracking-status-meaning.html) – etichetta creata, in transito, in consegna, eccezione, in ritardo
- [FedEx: Package not moving](https://www.fedex.com/en-us/customer-support/faqs/receiving/tracking-questions/package-not-moving.html) – 24 ore senza scansioni
- [Mondial Relay: Combien de jours pour retirer mon colis](https://www.mondialrelay.fr/faq/recevoir-un-colis/combien-de-jours-ai-je-pour-retirer-mon-colis-en-locker-ou-point-relais/) – Italia 7 giorni, nessuna proroga, ritorno al mittente
- [La Posta: Eventi «Monitorare gli invii»](https://www.post.ch/it/ricezione/monitorare-gli-invii/eventi-monitorare-gli-invii) – stati, dogana, recapito, errore di avviamento, rinvio
- [La Posta: FAQ su importazione, dogana e IVA](https://www.post.ch/it/soluzioni-commerciali/esportazione-importazione-e-sdoganamento/importazione/faq-su-importazione-dogana-e-iva) – sdoganamento in tre o quattro giorni lavorativi
- [La Posta: Invito di ritiro](https://www.post.ch/it/ricezione/invito-di-ritiro) – 7 e 15 giorni, proroga, secondo recapito, inoltro, prezzi
- [La Posta: PostPac Priority](https://www.post.ch/it/spedire-pacchi/pacchi-svizzera/postpac-priority) – giorno feriale successivo
- [La Posta: PostPac Economy](https://www.post.ch/it/spedire-pacchi/pacchi-svizzera/postpac-economy) – due giorni lavorativi
- [La Posta: Attuali tentativi di frode](https://site.post.ch/it/chi-siamo/sicurezza/phishing-e-frodi/tentativi-di-frode-attuali) – «Pacco trattenuto presso il terminale», verifica su posta.ch o nella Post-App
- [DHL: What does my shipment status mean?](https://www.dhl.de/en/privatkunden/hilfe-kundenservice/sendungsverfolgung/was-bedeutet-mein-sendungsstatus.html) – stati fermi per ore o giorni
- [DHL: International shipment status](https://www.dhl.de/en/privatkunden/hilfe-kundenservice/themen/international/sendungsverfolgung/was-bedeutet-mein-sendungsstatus.html) – dogana in alcuni giorni lavorativi, tracking del corriere di destinazione
- [Peek: home page](https://peektracker.com/it) – «Controllato fino a ogni 10 min» e «Fino a ogni 2 min nell'ultimo miglio»
:::
