---
title: Come capire il corriere dal numero di tracking
description: Dal formato del codice si risale spesso al corriere: prefissi, lunghezze ed esempi per Poste, BRT, GLS, InPost, DHL, UPS, la Posta svizzera e i pacchi dalla Cina.
slug: corriere-dal-numero-di-tracking
picture: Tre codici di tracking divisi in parti colorate, una lente sul codice paese CH e Pip che osserva incuriosito.
published: 2026-10-09
updated: 2026-10-09
---

Spesso bastano le lettere e la lunghezza del numero di tracking per capire quale corriere ha il tuo pacco. `1Z` seguito da 16 lettere e cifre è UPS, 18 cifre che iniziano con `99` sono la Posta svizzera, e un codice di 13 caratteri come `RR123456785CH` (due lettere, nove cifre, due lettere) di solito è di una posta nazionale, con il Paese che l'ha emesso nelle ultime due lettere. Il caso difficile sono i codici di sole cifre: 14 cifre, per esempio, possono essere di BRT come di DPD. In quei casi l'ultima parola spetta all'e-mail di spedizione, o a un tracker che prova tutti i corrieri possibili.

## Ho il codice tracking ma non so il corriere: come faccio?

Quattro controlli, in quest'ordine:

:::steps
- Guarda le lettere | Sono l'indizio più forte. `1Z` all'inizio è UPS; due lettere alla fine di solito indicano una posta nazionale.
- Conta i caratteri | La lunghezza da sola decide di rado, ma esclude qualche corriere. Non contare gli spazi: servono solo a rendere il codice più leggibile. Poste Italiane, per esempio, chiede di scriverlo «senza interruzioni e senza trattino».
- Controlla l'e-mail | L'e-mail o l'SMS di spedizione del negozio di solito indica il corriere o porta alla sua pagina di tracking. Vale più di qualsiasi ipotesi.
- Prova sui siti dei corrieri | Inserisci il codice sul sito di ogni corriere possibile. Quello che mostra delle scansioni ha il tuo pacco.
:::

Se non hai voglia di fare il detective, incolla il codice, un link del corriere o l'intera e-mail di spedizione in [Peek](/): trova il numero e riconosce il corriere tra più di 3.500.

## Com'è fatto il codice di ogni corriere

Ecco cosa dicono i corrieri, e lo standard postale, sui codici che incontri più spesso in Italia e in Ticino:

| Corriere | Com'è fatto il codice |
| --- | --- |
| Poste Italiane | Poste lo chiama «codice spedizione». Con Poste Delivery Web è un codice di 13 caratteri, stampato in alto a destra sulla lettera di vettura, come negli esempi di Poste `JG00000104876` ed `EG00000102369`; nel formato postale internazionale finisce con `IT` |
| BRT (ex Bartolini) | «BRTcode» di 14 o 19 cifre, oppure «numero di spedizione» di 12 o 14 cifre |
| GLS Italia | spedizione nazionale: due lettere, o una lettera e una cifra, seguite da al massimo 9 cifre (esempio di GLS: `Y1 550012467`); spedizione internazionale: 11 cifre |
| InPost | il modulo «Trova il tuo pacco» accetta 8, 10, 11, 13, 15, 22, 24 o 26 cifre, oppure due formati con lettere: `LM` + 9 cifre + `IT`, o 4 lettere + 15 cifre |
| DHL | DHL Express: 10 cifre, mai lettere. DHL in Germania: da 10 a 39 caratteri |
| UPS | `1Z` + 16 lettere e cifre, 18 caratteri in tutto, come `1Z999AA10123456784`, un esempio con una cifra di controllo UPS valida |
| La Posta (Svizzera) | la Posta lo chiama «numero d'invio». Sui pacchi spediti dalle aziende ha 18 cifre che iniziano con `99`, stampate con i punti come `99.34.123456.12345678` (il 99, il numero di licenza di affrancatura del mittente e un numero progressivo); altrimenti è il formato postale che finisce con `CH` |
| Amazon | Amazon non pubblica un formato; i codici `IT…` sono spiegati più sotto |
| YunExpress | `YT` + 16 cifre |
| China Post, EMS | il formato postale che finisce con `CN`; i numeri EMS internazionali iniziano con `E` |

### Codice che inizia con YT, LP, 5P o 1Z: di chi è?

Sono i prefissi che si cercano di più:

- `1Z`: UPS, come mostrano le sue etichette.
- `YT`: YunExpress, se seguono 16 cifre; il suo sito di tracking chiede proprio un numero che inizia con YT. Ma nei dati dei corrieri che usa Peek `YT` + 13 cifre è YTO Express, e `YT` + nove cifre + `GB` è un codice postale della Royal Mail britannica.
- `LP`: negli stessi dati, `LP` seguito da 14 cifre è un possibile codice AliExpress/Cainiao, e `LP` + 13 cifre + `CN` un possibile codice 4PX. Cainiao non descrive il formato sul suo sito, quindi prendilo solo come un indizio.
- `5P`: negli stessi dati, `5P` seguito da 11 lettere e cifre è Poste Italiane. Il modulo di ricerca di Poste però non parla di questo formato.

## Quante cifre ha un codice di tracking?

Non c'è una lunghezza unica. Queste sono le lunghezze che i corrieri indicano sulle loro pagine, e le sovrapposizioni spiegano perché un codice di sole cifre può andare bene per più corrieri:

| Lunghezza | Chi la usa |
| --- | --- |
| 10 cifre | DHL Express; InPost |
| 11 cifre | GLS Italia, spedizioni internazionali; InPost |
| 12 cifre | BRT, numero di spedizione |
| 13 caratteri | Poste Delivery Web; il formato postale internazionale; InPost, con sole cifre |
| 14 cifre | BRT, BRTcode o numero di spedizione; DPD, secondo le sue pagine per Austria e Belgio (quella tedesca parla di 14 caratteri) |
| 18 cifre | La Posta svizzera, quando il codice inizia con `99` |
| 19 cifre | BRT, BRTcode |
| 8, 15, 22, 24 o 26 cifre | InPost |
| da 10 a 39 caratteri | DHL in Germania |

Se cerchi il «codice tracking BRT di 18 cifre», sappi che BRT non ne parla: il suo campo di ricerca chiede un BRTcode di 14 o 19 cifre o un numero di spedizione di 12 o 14, e se la lunghezza non va risponde «Deve essere 14 o 19 cifre» o «Deve essere 12 o 14 cifre».

## Tracking che inizia con IT: che corriere è?

Se dopo `IT` ci sono 10 cifre, di solito è Amazon. Negli stessi dati dei corrieri citati sopra, `IT` seguito da 10 cifre è Amazon Logistics, il servizio di consegna di Amazon; lo stesso schema vale con altri codici paese (`DE`, `FR`, `ES`…) e con `TBA`, `TBC` o `TBM` seguiti da 12 cifre. La pagina di aiuto di Amazon.it su Amazon Logistics però non descrive il numero. Spiega invece che Amazon Logistics lavora con partner di consegna locali e regionali, e che il tuo ordine si traccia nella sezione *I miei ordini*.

Non confonderlo con un codice che *finisce* con `IT`: due lettere, nove cifre e `IT` è il formato postale con il codice dell'Italia, come l'esempio nel modulo di ricerca di Poste (`ZA123456789IT`).

## Il formato postale: due lettere, nove cifre, due lettere

Le poste nazionali condividono un formato di 13 caratteri, fissato dall'Unione postale universale (UPU) nel suo standard S10. Eccolo smontato:

:::anatomy RR 12345678 5 CH
- RR | Tipo di invio: R per una raccomandata
- 12345678 | Numero di serie, otto cifre
- 5 | Cifra di controllo, calcolata dal numero di serie
- CH | Paese che ha emesso il codice: la Svizzera
:::

Per gli invii che attraversano un confine, la prima lettera indica il tipo di invio. All'interno del proprio Paese, ogni posta può usare le lettere in modo diverso.

- `E`: EMS, il servizio espresso delle poste
- `C`: pacco
- `R`: raccomandata
- `L`: lettera tracciata
- `V`: lettera assicurata
- `U`: merce spedita come lettera, senza tracciamento per te

Le ultime due lettere non dicono sempre da dove parte il pacco. Per l'UPU il codice paese non è un indicatore affidabile dell'origine geografica: la Posta svizzera usa `CH` anche per gli invii che spedisce dai suoi uffici all'estero, e le poste portoghesi CTT danno codici che finiscono con `PT` a invii che i loro clienti con contratto spediscono dalla Spagna, dalla Cina e da altri Paesi.

La cifra di controllo serve a scovare gli errori di battitura. Per verificare un codice:

1. Moltiplica le otto cifre del numero di serie per 8, 6, 4, 2, 3, 5, 9 e 7, e somma i risultati.
2. Dividi per 11 e sottrai il resto da 11.
3. Se ottieni 10 la cifra è 0, se ottieni 11 è 5.

Per `RR123456785CH`: 8 + 12 + 12 + 8 + 15 + 30 + 63 + 56 = 204, che diviso per 11 dà resto 6, e 11 − 6 = 5. Se un codice postale copiato a mano non supera la prova, cerca una cifra sbagliata o due cifre invertite. Attenzione però agli esempi nei moduli dei corrieri: molti, come `ZA123456789IT` di Poste, sono solo segnaposto e la prova non la superano.

### Codice che inizia con UL o UU: di chi è?

Se ha 13 caratteri e finisce con due lettere, per esempio `CN`, è un codice postale della serie `U`: merce spedita come lettera. Le ultime due lettere dicono quale posta l'ha emesso. Un codice più lungo che inizia con `UU` non è in questo formato: cerca il corriere nell'e-mail di spedizione.

> Sulla posta dall'estero, un codice postale che inizia con `U` (da `UA` a `UZ`) non è fatto per essere seguito da te. L'UPU riserva quella serie alla merce spedita come lettera, senza un tracciamento rivolto al cliente, e le poste belghe bpost dicono chiaramente che un pacco così non si può seguire. Non contare sul fatto che prima o poi inizi ad aggiornarsi.

## Numeri che non sono il tuo codice di tracking

Con un pacco viaggiano anche altri numeri:

- **Non sono codici di tracking:** il numero d'ordine, che è del negozio (DHL ricorda che il numero di spedizione non è un numero d'ordine), e il codice prenotazione ritiro di Poste, come `CP123456789`, che segue il ritiro a domicilio, non la spedizione.
- **Funziona, ma accorciato:** l'ID collo GLS. GLS chiede di togliere gli zeri iniziali e la sigla finale: per `0000 35638867 GLS` scrivi solo `35638867`.

Gli avvisi lasciati dal corriere, il riferimento del mittente e cosa fare se hai solo il numero d'ordine: [dove trovare il codice di tracking](guide:find-tracking-number).

## Perché il codice di tracking può cambiare durante il viaggio

Un pacco che attraversa un confine passa spesso di mano, e ogni azienda può stampare la sua etichetta. L'UPU permette alla posta di destinazione di aggiungere un suo codice a barre accanto all'originale, purché non sia nel formato postale di 13 caratteri.

:::journey
- shop | Venditore | Stampa l'etichetta e il primo codice
- plane | Volo | Viaggia con quel primo codice
- customs | Dogana | Controllo nel tuo Paese
- handover | Corriere locale | Può aggiungere etichetta e codice suoi
- home | Casa tua | Le ultime scansioni possono stare sotto il nuovo codice
:::

- **Gli invii postali** sono il caso semplice: l'UPU ammette un solo codice S10 per invio, quindi di solito funziona sui siti di entrambe le poste.
- **Il numero aggiunto all'arrivo** può avere tutt'altra forma. Nell'esempio dello standard UPU, la posta di destinazione ha messo accanto al codice d'origine il numero `98.00.802077.23271453` e ha collegato i due nel suo sistema: 18 cifre con i punti, come i numeri della Posta svizzera. Se sul pacco compare un secondo numero così, prova anche quello.
- **Spedizioni economiche di AliExpress:** Cainiao dice che il tracking si ferma alla consegna al corriere locale, e che il venditore può dirti come contattarlo. Di più in [seguire un pacco dalla Cina](guide:tracking-from-china).

Un codice che non dà risultati non è per forza sbagliato. Le poste portoghesi CTT danno due motivi: il codice serve solo per la dogana, oppure l'invio lo consegna un'altra azienda, e in questi casi consigliano di sentire il mittente. Un codice può perfino mostrare una destinazione sbagliata: DHL Express spiega che ricicla periodicamente i numeri delle lettere di vettura, e che a volte due spedizioni viaggiano con lo stesso numero, anche se il pacco va comunque dove deve. Se un codice valido semplicemente non si muove ancora, leggi [perché il tracking non si aggiorna](guide:tracking-not-updating).

:::sources
- [UPU: standard S10, Identification of postal items](https://www.upu.int/UPU/media/upu/files/postalSolutions/programmesAndServices/standards/S10-12.pdf) – il formato postale, le lettere, la cifra di controllo, il codice paese, il numero aggiunto a destinazione
- [Poste Italiane: Cerca spedizioni, modulo di ricerca](https://www.poste.it/cerca/partials/forms-ricerche.html) – «senza interruzioni e senza trattino», l'esempio ZA123456789IT
- [Poste Italiane: FAQ Poste Delivery Web](https://www.poste.it/assistenza/faq-poste-delivery-web) – il codice spedizione di 13 caratteri e i suoi esempi, il codice prenotazione ritiro
- [BRT: Tracking](https://services.brt.it/it/tracking) – BRTcode di 14 o 19 cifre, numero di spedizione di 12 o 14, i messaggi d'errore
- [GLS Italia: Ricerca spedizione](https://gls-group.com/IT/it/servizi-online/ricerca-spedizioni/) – riferimento nazionale e internazionale, ID collo
- [InPost: Trova il tuo pacco](https://inpost.it/) – i formati accettati dal modulo di ricerca
- [La Posta: Monitorare gli invii](https://www.post.ch/it/ricezione/monitorare-gli-invii) – numero d'invio
- [La Posta: Barcode for Business Customers, gennaio 2026](https://handbuch.post.ch/-/media/post/gk/dokumente/1864-Anleitung-Barcodes-GK.pdf) – 18 cifre che iniziano con 99, stampate con i punti
- [DHL Express Netherlands: DHL Express or DHL eCommerce number](https://www.dhlexpress.nl/en/consumer/faq/express-account-zendingsnummer/my-shipment-number-dhl-express-or-dhl-ecommerce) – 10 cifre
- [DHL: Sendungsverfolgung, Probleme und Lösungen](https://www.dhl.de/de/privatkunden/hilfe-kundenservice/sendungsverfolgung/probleme-loesungen.html) – da 10 a 39 caratteri, non è un numero d'ordine
- [MyDHL Express Svizzera: FAQ Ricerca e Monitoraggio](https://mydhl.express.dhl/ch/it/help-and-support/faqs/tracking-monitoring.html) – numeri delle lettere di vettura riciclati
- [DPD Germany: Wo finde ich meine Paketnummer?](https://www.dpd.com/de/de/faq/wo-finde-ich-meine-paketnummer/) – 14 caratteri
- [DPD Austria: Wo finde ich die Paketnummer?](https://www.dpd.com/at/de/faq/wo-finde-ich-die-paketnummer-2/) – 14 cifre
- [DPD Belgium: Where do I find the parcel number?](https://www.dpd.com/be/en/faq/where-do-i-find-the-parcel-number-2/) – 14 cifre
- [UPS: sample package label](https://www.pld-certify.ups.com/CerttoolHelp/PLD0200/WebHelp_pld0200/LeadPackage.htm) – il numero 1Z
- [YunExpress: YunTrack](https://www.yuntrack.com/) – numeri che iniziano con YT
- [Cainiao: Help centre](https://global.cainiao.com/helpDoc.htm) – niente tracking dopo la consegna al corriere locale con le spedizioni economiche, chiedere al venditore
- [Amazon.it: Consegne effettuate tramite Amazon Logistics](https://www.amazon.it/gp/help/customer/display.html?nodeId=GEW3XT9JEMBLTKRV) – partner di consegna locali e regionali, tracking in I miei ordini
- [Universal Parcel Scraper: carrier catalog](https://github.com/plhery/universal-parcel-scraper/blob/main/data/catalog.json) – i formati IT, TBA, LP, 5P e YT nei dati dei corrieri di Peek
- [bpost: Puis-je suivre mon colis en ligne ?](https://www.bpost.be/fr/faq/puis-je-suivre-mon-colis-en-ligne) – i codici che iniziano con U non si possono seguire
- [CTT: Encontrar o código de envio](https://www.ctt.pt/ajuda/particulares/seguir-ou-alterar-entrega/seguir/encontrar-o-codigo-de-envio) – codici PT per invii dall'estero, codici che non danno risultati, contattare il mittente
:::
