---
title: Sendungsnummer: Welcher Paketdienst steckt dahinter?
description: An Anfang, Länge und Endung der Sendungsnummer erkennst du oft den Paketdienst. So sehen die Nummern von DHL, Hermes, DPD, UPS und der Post aus.
slug: sendungsnummer-welcher-paketdienst
picture: Drei Etiketten mit Sendungsnummern, in farbige Teile zerlegt, eine Lupe auf dem Ländercode CH, und Pip schaut neugierig zu.
published: 2026-10-09
updated: 2026-10-10
---

Buchstaben und Länge einer Sendungsnummer verraten oft, welcher Paketdienst dein Paket hat. Beginnt sie mit `1Z` und hat 18 Zeichen, ist es UPS. 18 Ziffern ab `99`, gedruckt wie `99.34.123456.12345678`, kommen von der Schweizerischen Post, und 13 Zeichen wie `RR123456785CH` (zwei Buchstaben, neun Ziffern, zwei Buchstaben) stammen meist von einer nationalen Post, deren Land in den letzten zwei Buchstaben steht. Schwierig wird es bei reinen Ziffern: 10, 14 oder 22 Stellen passen jeweils zu mehreren Paketdiensten. Dann entscheidet die Versandmail oder ein Tracker, der die infrage kommenden Paketdienste durchprobiert.

## Wie erkenne ich den Paketdienst an der Sendungsnummer?

Vier Schritte, in dieser Reihenfolge:

:::steps
- Schau auf die Buchstaben | Sie verraten am meisten. `1Z` am Anfang heißt UPS, zwei Buchstaben am Ende meist eine Post.
- Zähl die Zeichen | Die Länge allein entscheidet selten, schließt aber Paketdienste aus. Leerzeichen und Punkte zählst du nicht mit: Sie stehen nur zum besseren Lesen da.
- Schau in die Versandmail | Die Versandbestätigung des Shops, per Mail oder SMS, nennt meist den Paketdienst oder verlinkt seine Sendungsverfolgung. Das ist verlässlicher als jedes Raten.
- Probier es aus | Gib die Nummer bei jedem Paketdienst ein, der infrage kommt. Der Paketdienst, der dazu Scans anzeigt, hat dein Paket.
:::

Keine Lust auf Detektivarbeit? Füge die Nummer, einen Link vom Paketdienst oder gleich die ganze Versandmail in [Peek](/) ein: Die Nummer wird herausgefischt und der Paketdienst unter mehr als 3.500 automatisch erkannt. Wie solche Tracker eine Nummer zuordnen, erklärt [Paketverfolgung aller Anbieter](guide:universal-tracker).

## Wie sieht eine Sendungsnummer von DHL, Hermes, DPD oder UPS aus?

Das schreiben die Paketdienste selbst und der internationale Poststandard über die Nummern, die dir in Deutschland, Österreich und der Schweiz am häufigsten begegnen:

| Paketdienst | So sieht die Nummer aus |
| --- | --- |
| DHL Paket | 10 bis 39 Stellen, Ziffern und Buchstaben, je nach Produkt. DHL Päckchen haben keine Sendungsverfolgung, außer DHL Päckchen International mit dem Service „Versicherung“ |
| DHL Express | 10 Ziffern, nie Buchstaben, sagt DHL Express in den Niederlanden |
| Deutsche Post (Briefe) | kein Format veröffentlicht. Verfolgen lassen sich Einschreiben, Nachnahme, PRIO und Wert National, dazu als Basis-Sendungsverfolgung Briefe mit Matrixcode-Briefmarke, die du vorher in der Post & DHL App scannst |
| Hermes (Deutschland) | 14 bis 20 Zeichen, Buchstaben und Ziffern |
| DPD | 14 Zeichen, sagt DPD Deutschland; 14 Stellen, sagt DPD Österreich |
| GLS | Paketnummer oder Track-ID von der Benachrichtigungskarte. Eine Länge nennt GLS nicht |
| UPS | `1Z` plus 16 Buchstaben und Ziffern, 18 Zeichen insgesamt, etwa `1Z999AA10123456784`, ein Beispiel mit gültiger UPS-Prüfziffer |
| Österreichische Post | 22 Ziffern oder das Postformat aus zwei Buchstaben, neun Ziffern und zwei Buchstaben |
| Schweizerische Post | 18 Ziffern ab `99` auf Paketen von Geschäftskunden, gedruckt wie `99.34.123456.12345678`, oder das Postformat mit `CH` am Ende |
| [Quickpac](carrier:quickpac) | 18 Ziffern, sagt Quickpac, aber nicht, wie sie beginnen. In Peeks Paketdienst-Daten: ab `44` |
| [Planzer](carrier:planzer) | kein Format veröffentlicht. In Peeks Paketdienst-Daten 20 Ziffern ab `91346097`, eine geteilte Planzer-Sendung 13 Ziffern ab `99990` |
| Amazon | kein Format veröffentlicht, mehr dazu weiter unten |
| [YunExpress](carrier:yunexpress) | `YT` + 16 Ziffern; `YT` + 13 Ziffern ist YTO Express |
| [Cainiao](carrier:cainiao) (AliExpress) | `DOFR` oder `CNFR` plus 13 Ziffern und `HD`; `LP` oder `CNG` plus 14 Ziffern sind wahrscheinlich Cainiao, aber nicht sicher. So steht es in Peeks Paketdienst-Daten, Cainiao selbst beschreibt diese Formen nicht |
| China Post, EMS | das Postformat mit `CN` am Ende. Internationale EMS-Nummern beginnen mit `E` |

Bei Hermes merkst du sofort, wenn die Länge nicht stimmt. Die Sendungsverfolgung meldet dann `Sendungsnummer muss aus 14-20 Zeichen bestehen (Buchstaben, Zahlen).`

### Sendungsnummer beginnt mit JJD, 0034 oder H?

Auf seinen Hilfeseiten nennt DHL nur die Länge, kein Format. Die Entwicklerdokumentation der DHL-Sendungsverfolgung arbeitet aber mit 20-stelligen Testnummern, die alle mit `00340434` beginnen. In den Paketdienst-Daten, die Peek nutzt, gehören zu DHL: Nummern ab `JJD` (folgen genau 16 Ziffern, kommt auch InPost infrage), `JD` plus 18 Ziffern und 20 Ziffern ab `00340433`, `00340434` oder `00340435`. `H` plus 16 bis 19 Ziffern ist dort Hermes. Beginnt die Nummer mit `DE`, lies den Abschnitt zu Amazon.

## Wie viele Stellen hat eine Sendungsnummer?

Eine feste Länge gibt es nicht. Hier die Längen, die die Paketdienste selbst nennen. Die Überschneidungen zeigen, warum eine Nummer ohne Buchstaben zu mehreren passen kann:

| Länge | Wer sie nutzt |
| --- | --- |
| 10 Ziffern | DHL Express; bei DHL die kürzeste mögliche Länge |
| 13 Zeichen | jede Post im Postformat, etwa `RR123456785CH` |
| 14 Stellen | DPD; auch bei Hermes möglich |
| 18 Ziffern | Schweizerische Post, ab `99`; Quickpac |
| 20 Ziffern | DHL, etwa seine Testnummern ab `00340434` |
| 22 Ziffern | Österreichische Post; USPS bei Paketen aus den USA |
| 14 bis 20 Zeichen | Hermes |
| 10 bis 39 Stellen | DHL |

## Sendungsnummer beginnt mit TBA oder DE: Ist das Amazon?

Wenn die Länge stimmt, ja. In Peeks Paketdienst-Daten steht `TBA`, `TBC` oder `TBM` plus 12 Ziffern für Amazon Logistics, Amazons eigenen Lieferdienst. Dasselbe gilt für einen Ländercode wie `DE`, `AT` oder `CH` plus 10 Ziffern. Amazon selbst beschreibt diese Nummern auf seinen Hilfeseiten nicht. Laut Amazon.de verfolgst du solche Bestellungen unter „Meine Bestellungen“, wo die Informationen der Lieferpartner angezeigt werden.

## Das Postformat: zwei Buchstaben, neun Ziffern, zwei Buchstaben

Die nationalen Postunternehmen nutzen ein gemeinsames Format mit 13 Zeichen, festgelegt vom Weltpostverein (UPU) in seinem Standard S10. So ist es aufgebaut:

:::anatomy RR 12345678 5 CH
- RR | Art der Sendung: R für Einschreiben
- 12345678 | Seriennummer, acht Ziffern
- 5 | Prüfziffer, aus der Seriennummer berechnet
- CH | Land, das die Nummer vergeben hat: die Schweiz
:::

Bei Sendungen über die Grenze verrät der erste Buchstabe die Art der Sendung. Im Inland dürfen die Postunternehmen die Buchstaben anders belegen.

- `E`: EMS, der Expressdienst der Postunternehmen
- `C`: Paket
- `R`: Einschreiben
- `L`: Brief mit Sendungsverfolgung
- `V`: Wertbrief
- `U`: Ware im Brief, ohne Sendungsverfolgung für dich

Die letzten zwei Buchstaben verraten nicht immer, wo das Paket aufgegeben wurde. Laut UPU taugt der Ländercode nicht als verlässlicher Hinweis auf die Herkunft: Die Schweizerische Post nutzt `CH` auch für Sendungen, die sie aus ihren Niederlassungen im Ausland verschickt. Und hat ein Land mehrere Postunternehmen, verrät der Code allein nicht, welches die Nummer vergeben hat.

Die Prüfziffer fängt Tippfehler ab. So prüfst du eine Nummer:

1. Multipliziere die acht Ziffern der Seriennummer der Reihe nach mit 8, 6, 4, 2, 3, 5, 9 und 7 und addiere die Ergebnisse.
2. Teile die Summe durch 11 und zieh den Rest von 11 ab.
3. Aus 10 wird 0, aus 11 wird 5.

Für `RR123456785CH`: 8 + 12 + 12 + 8 + 15 + 30 + 63 + 56 = 204. Geteilt durch 11 bleibt der Rest 6, und 11 − 6 = 5. Fällt eine abgetippte Postnummer durch diesen Test, such nach einer falschen Ziffer oder einem Zahlendreher.

### Sendungsnummer beginnt mit LX, RT oder CY?

Hat sie 13 Zeichen, also zwei Buchstaben, neun Ziffern und zwei Buchstaben, ist es meist eine Postnummer. Der erste Buchstabe nennt die Art der Sendung: `L` einen Brief mit Sendungsverfolgung, `R` ein Einschreiben, `C` ein Paket. Den zweiten Buchstaben wählt die Post, die die Nummer vergibt, und das Ende nennt ihr Land: `DE` für Deutschland, `AT` für Österreich, `CH` für die Schweiz, `CN` für China. Eine längere Nummer mit denselben Anfangsbuchstaben hat dieses Format nicht: Dann nennt dir die Versandmail den Paketdienst.

> Beginnt die Postnummer einer Sendung aus dem Ausland mit `U` (`UA` bis `UZ`), ist sie nicht zum Mitverfolgen gedacht. Die UPU reserviert diesen Bereich für Waren im Brief, die für Kunden keine Sendungsverfolgung haben, und die belgische Post bpost schreibt klar: Wenn der Strichcode mit dem Buchstaben U beginnt, „kann die Sendung nicht verfolgt werden“. Rechne nicht damit, dass später doch noch Scans auftauchen.

## Nummern, die nicht deine Sendungsnummer sind

Die Bestellnummer stammt vom Shop, und DHL erinnert daran, dass sie keine Sendungsnummer ist. Hast du nur eine Bestellnummer oder einen Code von der Benachrichtigungskarte, lies nach, [wo du die Sendungsnummer findest](guide:find-tracking-number).

## Warum sich die Sendungsnummer unterwegs ändern kann

Ein Paket, das eine Grenze überquert, wechselt oft den Paketdienst, und jeder kann sein eigenes Etikett aufkleben. Die UPU erlaubt der Post im Zielland, neben die ursprüngliche Nummer einen eigenen Strichcode zu setzen, solange er nicht das 13-stellige Postformat hat.

:::journey
- shop | Verkäufer | Druckt das Etikett und die erste Nummer
- plane | Langstrecke | Reist mit dieser ersten Nummer
- customs | Zoll | Kontrolle in deinem Land
- handover | Paketdienst vor Ort | Kann ein eigenes Etikett und eine neue Nummer aufkleben
- home | Deine Haustür | Die letzten Scans stehen vielleicht unter der neuen Nummer
:::

- **Postsendungen** sind der einfache Fall: Die UPU erlaubt nur eine S10-Nummer pro Sendung, deshalb funktioniert sie meist bei der Post im Absender- und im Empfängerland.
- **Eine zweite Nummer der Post im Zielland** zeigt der UPU-Standard als Beispiel: Eine Importsendung bekommt dort zusätzlich `98.00.802077.23271453`, mit Punkten wie bei der Schweizerischen Post, und die Post verknüpft beide Nummern.
- **AliExpress mit Economy-Versand:** Laut Cainiao endet die Sendungsverfolgung bei der Übergabe an den Paketdienst im Zielland, und der Verkäufer kann dir sagen, wie du diesen erreichst. Mehr dazu unter [Paket aus China verfolgen](guide:tracking-from-china).

### Sendungsnummer ungültig oder nicht gefunden?

Findet die Sendungsverfolgung nichts, ist die Nummer nicht unbedingt falsch abgetippt. Meldet die DHL-Sendungsverfolgung `Die eingegebene Sendungsnummer ist ungültig`, nennt DHL außer einem Zahlendreher diese Gründe: Bei DHL Paket kann es bis zu 24 Stunden dauern, bis die Sendung erscheint. Es ist ein DHL Päckchen, und Päckchen haben keine Sendungsverfolgung. Es ist ein Paket aus dem Ausland, eine Express- oder eine Briefsendung, die du in einer anderen Sendungsverfolgung findest. Oder die Sendung wurde gar nicht mit DHL verschickt. Ist die Nummer gültig, tut sich aber nichts, lies nach, [warum sich die Sendungsverfolgung nicht aktualisiert](guide:tracking-not-updating).

:::sources
- [UPU: S10 standard, Identification of postal items](https://www.upu.int/UPU/media/upu/files/postalSolutions/programmesAndServices/standards/S10-12.pdf) – das Postformat, seine Buchstaben, Prüfziffer und Ländercode, die zusätzliche Nummer der Zielpost
- [DHL: Hilfe bei Problemen mit Sendungsverfolgung](https://www.dhl.de/de/privatkunden/hilfe-kundenservice/sendungsverfolgung/probleme-loesungen.html) – 10 bis 39 Stellen, keine Bestellnummer, Päckchen, Briefprodukte mit Sendungsverfolgung, Gründe für „ungültig“
- [DHL Developer: DHL Parcel DE Tracking (Post & Parcel Germany)](https://developer.dhl.com/api-reference/dhl-parcel-de-shipment-tracking-post-parcel-germany) – Testnummern ab 00340434
- [DHL Express Niederlande: DHL Express or DHL eCommerce number](https://www.dhlexpress.nl/en/consumer/faq/express-account-zendingsnummer/my-shipment-number-dhl-express-or-dhl-ecommerce) – 10 Ziffern
- [Deutsche Post: Sendungsverfolgung für Briefe und Pakete](https://www.deutschepost.de/de/s/sendungsverfolgung.html) – Einschreiben, Basis-Sendungsverfolgung mit der Post & DHL App
- [Hermes: Sendungsverfolgung](https://www.myhermes.de/empfangen/sendungsverfolgung/) – 14 bis 20 Zeichen
- [DPD Deutschland: Wo finde ich meine Paketnummer?](https://www.dpd.com/de/de/faq/wo-finde-ich-meine-paketnummer/) – 14 Zeichen
- [DPD Österreich: Wo finde ich die Paketnummer?](https://www.dpd.com/at/de/faq/wo-finde-ich-die-paketnummer-2/) – 14 Stellen
- [GLS Österreich: Sendungsverfolgung](https://gls-group.com/AT/de/paket-verfolgen/) – Paketnummer und Track-ID auf der Benachrichtigungskarte
- [UPS: sample package label](https://www.pld-certify.ups.com/CerttoolHelp/PLD0200/WebHelp_pld0200/LeadPackage.htm) – die 1Z-Nummer
- [Österreichische Post: Startseite, Häufig gestellte Fragen](https://www.post.at/) – 22 Ziffern oder Postformat
- [Schweizerische Post: Anleitung Barcode für Geschäftskunden](https://www.post.ch/-/media/post/gk/dokumente/1864-anleitung-barcodes-gk.pdf?sc_lang=de) – 18 Ziffern ab 99, die Punkte im Klartext
- [Quickpac: FAQ (auf Englisch)](https://quickpac.ch/en/faq) – jedes Paket hat eine 18-stellige Nummer
- [USPS: Publication 199, Intelligent Mail package barcode](https://postalpro.usps.com/pub199) – 22 Ziffern
- [Amazon.de: Lieferungen von Amazon Logistics](https://www.amazon.de/gp/help/customer/display.html?nodeId=GEW3XT9JEMBLTKRV) – Sendungsverfolgung unter Meine Bestellungen
- [Universal Parcel Scraper: carrier catalog](https://github.com/plhery/universal-parcel-scraper/blob/main/data/catalog.json) – JJD, JD, 0034043, H, TBA und Ländercode plus 10 Ziffern in Peeks Paketdienst-Daten, dazu YT + 16 Ziffern (YunExpress), YT + 13 Ziffern (YTO Express), 44 (Quickpac), 91346097 und 99990 (Planzer) sowie DOFR, CNFR, LP und CNG (Cainiao)
- [YunExpress: YunTrack](https://www.yuntrack.com/) – Nummern ab YT
- [Cainiao: Help centre](https://global.cainiao.com/helpDoc.htm) – beim Economy-Versand keine Sendungsverfolgung nach der Übergabe
- [bpost: Kann ich mein Paket online verfolgen?](https://www.bpost.be/de/faq/kann-ich-mein-paket-online-verfolgen) – Strichcodes mit U lassen sich nicht verfolgen
:::
