---
title: YunExpress Sendungsverfolgung: Status, Zusteller, Kontakt
description: YunExpress-Paket aus China verfolgen: die YT-Nummer, was die englischen Status bedeuten, wer in Deutschland, Österreich und der Schweiz zustellt, wen du fragst.
slug: yunexpress-sendungsverfolgung
published: 2026-10-10
updated: 2026-10-10
---

YunExpress, oft auch Yun Express geschrieben, ist ein Logistikunternehmen aus Shenzhen, das für Onlinehändler kleine Pakete aus China verschickt, auch für Verkäufer auf Amazon, Temu oder SHEIN. Für die Sendungsverfolgung gibst du die Nummer, die mit YT beginnt, auf [yuntrack.com](https://www.yuntrack.com/) ein, der Tracking-Seite von YunExpress, oder fügst sie oben ins Feld ein. Eine SMS oder E-Mail an Empfänger beschreibt YunExpress nirgends: Die Nummer steht in der Versand-E-Mail des Shops oder in deiner Bestellübersicht.

## YunExpress Trackingnummer: YT und 16 Ziffern

Yuntrack fragt nach „your YunExpress tracking number (starting with YT)“, also nach der Nummer mit YT am Anfang, und nennt keine Länge. Peek erkennt eine YunExpress-Nummer an YT und den 16 Ziffern dahinter. Mit erfundenen Ziffern:

| Nummer | Wem sie gehört |
| --- | --- |
| `YT1234567890123456` | YT und 16 Ziffern: YunExpress. |
| `YT1234567890123` | YT und 13 Ziffern: YTO Express, ein anderer Paketdienst. Verfolge sie dort. |
| `YT123456789012345` | YT und 15 Ziffern: keine YunExpress-Nummer. Prüf, ob eine Ziffer fehlt. |
| `LP12345678901234` | LP und 14 Ziffern: keine YunExpress-Nummer, wahrscheinlich [Cainiao](carrier:cainiao). |

Auch auf Amazon.de kann dein Paket mit YunExpress kommen: Laut YunExpress ist sein Angebot „FBM Ship+“ für Amazon-Händler, die selbst aus China versenden, unter anderem auf der deutschen Amazon-Seite gestartet. Hast du mit PayPal bezahlt und gibt der Händler das Tracking an PayPal weiter, siehst du den Status laut YunExpress auch in der PayPal-App, mit Push-Mitteilungen.

Übernimmt ein Paketdienst vor Ort, kann das Paket eine zweite Nummer bekommen: Yuntrack zeigt sie in der Spalte „Last Mile Tracking“ und auf der Detailseite unter „Additional Notes“. Meldet Yuntrack `Not Found`, prüf das YT und alle 16 Ziffern und lass dir die Nummer vom Shop bestätigen. Findest du gar keine Nummer, hilft dir [Sendungsnummer finden](guide:find-tracking-number).

## YunExpress Tracking auf Deutsch: was die Status bedeuten

Yuntrack gibt es nur auf Englisch, auch mit deutsch eingestelltem Browser, und eine Sprachauswahl fehlt. Jedes Paket steht unter einem von sechs Reitern: `Processing` (in Bearbeitung), `Transit` (unterwegs), `Delivered` (zugestellt), `Not Found` (nicht gefunden), `Alert` (Warnung) und `Returned` (zurückgeschickt). Darunter stehen die einzelnen Scans, ebenfalls auf Englisch. Die wichtigsten, ungefähr in der Reihenfolge, in der ein Paket sie erreicht:

| YunExpress schreibt | Was es für dich heißt |
| --- | --- |
| `Shipment information received` | Der Händler hat die Paketdaten übermittelt. YunExpress hat das Paket vielleicht noch nicht. |
| `Shipment picked up` | YunExpress hat das Paket beim Händler in China abgeholt. |
| `The country of origin commences customs declaration.` | Ausfuhranmeldung in China, noch nicht dein Zoll. |
| `International flight has departed` | Der Flug Richtung Zielland ist gestartet. |
| `Start Customs Clearence` | Die Einfuhrverzollung beginnt (Schreibweise von YunExpress). |
| `Customs inspection - Import` | Der Zoll hat das Paket für eine Kontrolle ausgewählt. |
| `Clearance processing completed - Import` | Verzollt, es geht weiter. |
| `Delivered to local carrier` | An den Paketdienst vor Ort übergeben, nicht an dich. |
| `Shipment in transit to DHL` | Unterwegs zu DHL, das die letzte Strecke übernimmt. |
| `Delivered by Mailbox` | In deinen Briefkasten gelegt. |
| `POD available` | Von DPD: Der Zustellnachweis liegt vor, das Paket ist zugestellt. |

Am verwirrendsten ist `Delivered to local carrier`: „Delivered“ heißt hier nur, dass YunExpress das Paket an den Paketdienst im Zielland weitergegeben hat. Danach folgen dessen Zeilen, auch sie auf Englisch. Steht schon früh `Sender goods issue` im Verlauf, stammt das von DPD: ein Datensatz, angelegt, während das Paket noch in China ist, und kein Problem mit deiner Ware.

`Transit` heißt nur unterwegs; welcher Schritt zuletzt kam, zeigt die neueste Zeile. Was unter `Alert` fällt, erklärt YunExpress nicht: Lies die Zeile darunter und frag den Shop, wenn sich nichts mehr tut. Im Seitencode von Yuntrack steckt außerdem eine Fortschrittsleiste (`Pickup`, `Departed from origin`, `Arrived at destination`, `Local carrier on the way`, `Delivered successfully`). Der Schritt `Pickup` meint die Abholung beim Händler, keine Abholstelle für dich.

## YunExpress Zustellung in Deutschland, Österreich und der Schweiz

YunExpress fliegt die Pakete aus China ins Zielland, lässt sie im Zielland verzollen und übergibt sie dann einem Paketdienst vor Ort. Eigene Linien hat es nach eigenen Angaben seit 2015 nach Deutschland, seit 2018 nach Österreich und seit 2020 in die Schweiz. Einen Zustellpartner für diese Länder nennt es auf seinen Seiten nicht, nur allgemein „premium global carrier networks“. In YunExpress-Verläufen tauchen DHL (`Shipment in transit to DHL`) und Zeilen von DPD auf; aus welchem Land, ist nicht festgehalten. Wer dein Paket hat, zeigen die Zeilen nach `Delivered to local carrier` und die Spalte „Last Mile Tracking“.

Die Standardlinie Standard Express nimmt Packstation-Adressen an, wenn das Paket höchstens 60 × 30 × 30 cm misst (sonst sind bis 60 × 40 × 35 cm erlaubt). Auf vorgelagerte Inseln europäischer Länder liefern die Standardlinien laut YunExpress nicht. In der Schweiz stellt die Sparlinie laut YunExpress im ganzen Land zu.

Zustellversuche, Benachrichtigungskarten, Lagerfristen oder einen neuen Termin regelt YunExpress für Empfänger nirgends. Hast du die Zustellung verpasst, schau, welcher Paketdienst im Tracking steht, und frag dort nach, wie er dich benachrichtigt, wie lange er Pakete aufbewahrt und wo du sie abholen kannst.

**Abholstellen und Paketautomaten.** Für Europa bietet YunExpress Händlern zwei Linien zur Abholung an. Bei der einen sucht YunExpress die Abholstelle oder den Paketautomaten, der dem Käufer am nächsten liegt, im Umkreis von 3 km, und hält die Bestellung an, wenn es keinen passenden gibt; bei der anderen wählt der Käufer selbst. Laut einem undatierten Artikel liegt das Paket im Schnitt 6 bis 10 Kalendertage nach dem Eingang bei YunExpress zur Abholung bereit. Die Adresse der Abholstelle zeigt das Tracking an. Welche Paketshops oder Automaten das sind, sagt YunExpress nicht.

## YunExpress Paket nicht angekommen: was du tun kannst

Für ein hängendes, verspätetes, verlorenes oder beschädigtes Paket nennt YunExpress Empfängern keine Schritte, kein Formular und keine Frist. Sein Kunde ist der Händler, der den Vertrag unterschreibt, und damit liegt auch jeder Anspruch beim Händler. Schreib also dem Shop oder Marktplatz, mit Bestellnummer und YT-Nummer. Bewegt sich tagelang nichts, lies, warum [die Sendungsverfolgung sich nicht aktualisiert](guide:tracking-not-updating).

Hängt das Paket bei `Customs inspection - Import`, nennt YunExpress in seinem Blog für Händler typische Zusatzzeiten: einige Arbeitstage bis etwa eine Woche, wenn nur die Unterlagen geprüft werden, oft ein bis zwei Wochen für eine Durchleuchtung oder Beschau, manchmal mit Lager- oder Prüfgebühren, und Wochen bis über einen Monat, wenn eine Behörde die Ware genauer untersucht. YunExpress meldete am 18. Juni 2026, die EU schaffe ab dem 1. Juli 2026 die Zollfreiheit für Pakete bis 150 € ab und erhebe vorläufig einen festen Zoll von „€3 per item“. Wer ihn bei deiner Bestellung zahlt, sagt YunExpress nicht. Was in Deutschland, Österreich oder der Schweiz auf dich zukommen kann, steht unter [Paket beim Zoll](guide:customs).

Mit PayPal bezahlt? Bei Händlern, die es eingerichtet haben, gibt YunExpress das Tracking an PayPal weiter, und laut YunExpress dient es dort als Beleg bei Konflikten. Welche Regeln dann gelten, steht bei PayPal.

Als zugestellt markiert, aber nichts da? Die Tracking-Seite kann einen Zustellnachweis anbieten, für den sie nach dem Namen des Empfängers fragt. Frag dann beim Paketdienst vor Ort und beim Shop nach. `Returned` heißt, das Paket geht zurück. Rückgaberegeln für Empfänger veröffentlicht YunExpress nicht, frag also den Shop.

## YunExpress Kontakt: Telefonnummer und E-Mail

Stand Oktober 2026 nennt YunExpress für Empfänger in Deutschland, Österreich und der Schweiz weder Telefonnummer noch Formular noch Büro. Eine deutsche Website hat es nicht: yunexpress.com gibt es nur auf Englisch, und yunexpress.de gehört nicht zu YunExpress. Veröffentlicht sind:

- **E-Mail:** info@yunexpress.com, als „Customer Service“ in der Fußzeile von yunexpress.com, 8:00 bis 23:00 Uhr ohne Angabe der Zeitzone. Ob Empfänger dort Antwort bekommen, steht nicht da; die Startseite verspricht Antworten auf Englisch und Chinesisch.
- **Telefon:** 400-8575-500 auf yunexpress.cn, eine Servicenummer in Festlandchina. Ob sie aus dem Ausland erreichbar ist, steht nirgends.
- **Regionale Kontakte:** nur für Länder in Asien und für Australien.

Das Feld „Feedback“ auf Yuntrack betrifft die Website, nicht dein Paket. Fang deshalb beim Shop an, der den Vertrag mit YunExpress hat. Nach der Übergabe ist der Paketdienst vor Ort dran, der im Tracking steht, etwa DHL oder DPD: Ihn erreichst du über seine eigenen Kanäle.

## YunExpress-Paket mit Peek verfolgen

[Peek](/) erkennt YT mit 16 Ziffern als YunExpress und nimmt auch Links von yuntrack.com an. Es schaut alle 10 Minuten nach, alle 2 Minuten, sobald das Paket in Zustellung ist, zeigt jeden Scan auf einer Karte und schickt dir Mitteilungen, wenn sich der Status ändert. Du siehst Status, Verlauf, den Ort jedes Scans und die Zustellzeit.

Nennt YunExpress die Nummer des Paketdiensts vor Ort in einer Form, die Peek kennt, verfolgt Peek das Paket dort weiter, allerdings nicht bei jedem Paket. Ein voraussichtliches Lieferdatum oder eine Abholstelle zeigt es bei YunExpress-Paketen nicht, die Bestellnummern des Händlers lässt es weg, und YunExpress kontaktieren oder etwas reklamieren kann es nicht für dich.

## Fragen zur YunExpress Sendungsverfolgung

### Was ist YunExpress?

Ein Logistikunternehmen für den Onlinehandel aus China: die Shenzhen Qianhai YunExpress Logistics Co., Ltd., nach eigenen Angaben 2014 in Shenzhen gegründet. Es verschickt für Onlinehändler Pakete in über 220 Länder und Regionen und ist laut eigener Aussage seit 2017 von Amazon empfohlener Logistikpartner.

### Wie lange braucht YunExpress nach Deutschland?

Laut YunExpress' Angaben für Händler 5 bis 8 Arbeitstage mit Standard Express und 6 bis 10 mit der Sparlinie; nach Österreich 6 bis 8 und 6 bis 10, in die Schweiz 6 bis 9 mit der Sparlinie. Welche Linie der Händler gebucht hat, siehst du meist nicht, und Zollkontrollen kosten zusätzlich Zeit.

### Stellt DHL YunExpress-Pakete zu?

Das sagt YunExpress nicht: Für Deutschland, Österreich und die Schweiz nennt es keinen Zustellpartner. In YunExpress-Verläufen taucht aber `Shipment in transit to DHL` auf, ebenso Zeilen von DPD, und Standard Express nimmt Packstation-Adressen an. Wer dein Paket hat, zeigen die Zeilen nach `Delivered to local carrier`.

### Kann ich ein YunExpress-Paket abholen?

Ja, wenn der Händler eine der Abhollinien von YunExpress gebucht hat: Dann zeigt das Tracking die Adresse der Abholstelle oder des Paketautomaten. Sonst frag beim Paketdienst vor Ort nach, der im Tracking steht: Wie er mit einem verpassten Zustellversuch umgeht, sagt YunExpress nicht. Eigene Paketshops für Empfänger nennt YunExpress nicht.

### Wie schicke ich ein YunExpress-Paket zurück?

Über den Shop: YunExpress veröffentlicht für Empfänger weder eine Rücksendeadresse noch Rückgaberegeln. Die Deutsche Post führt zwar die Hongkong Yunexpress Logistics Limited („YUN DE“) als Großempfänger in Dreieich, sagt aber nicht, wofür diese Adresse dient. Schick also nichts dorthin, solange der Shop es dir nicht sagt.

:::sources
- [YunExpress: Track & Trace Platform, Yuntrack](https://www.yuntrack.com/) – YT-Nummer, nur Englisch, Feedback
- [YunExpress: Tracking Results, Yuntrack](https://www.yuntrack.com/parcelTracking?id=YT1234567890123456) – Reiter, Last Mile Tracking, Not Found (erfundene Nummer)
- [YunExpress: Seitencode von Yuntrack](https://www.yuntrack.com/static/js/app.239f901b375358352522.js) – Alert, Fortschrittsleiste, Additional Notes, Zustellnachweis
- [YunExpress: the Best Logistics Service Provider](https://www.yunexpress.com/) – Firma, E-Mail und Zeiten, Englisch und Chinesisch, Partnernetze
- [YunExpress: About Us](https://www.yunexpress.com/about-us) – 2014, 220+ Länder, Linien nach Deutschland, Österreich und in die Schweiz, Amazon
- [YunExpress: Privacy Policy](https://www.yunexpress.com/privacy-policy) – Händler als Vertragskunde
- [YunExpress: Partners](https://www.yunexpress.com/yun-ecosystem/partners) – Marktplätze
- [YunExpress: 独家！FBM Ship+服务上线](https://www.yunexpress.com/newsroom/detail/4) – FBM Ship+ auf Amazon.de
- [YunExpress: 云途物流与PayPal打通轨迹信息对接](https://www.yunexpress.com/newsroom/detail/2) – PayPal-App, Konflikte
- [YunExpress: Standard Express](https://www.yunexpress.com/our-solutions/b2c/33) – Laufzeiten nach Deutschland und Österreich, Packstation
- [YunExpress: 全球专线挂号（标快带电）](https://www.yunexpress.com/our-solutions/b2c/5) – keine vorgelagerten Inseln
- [YunExpress: 全球专线挂号（特惠带电）](https://www.yunexpress.com/our-solutions/b2c/7) – Sparlinie, ganze Schweiz
- [YunExpress: 最高省21%！云途自提服务上线](https://www.yunexpress.com/newsroom/detail/3) – Abhollinien in Europa
- [YunExpress: EU Customs Reform 2026 & YunExpress Service Updates](https://www.yunexpress.com/newsroom/detail/13) – vorläufiger EU-Zoll ab 1. Juli 2026
- [YunExpress: 為什麼你的包裹會被海關抽查？](https://hk.yunexpress.com/blog/2179/) – Dauer von Zollkontrollen
- [YunExpress: 云途物流YunExpress](https://www.yunexpress.cn/) – Servicenummer in Festlandchina
- [YunExpress: Contact Us](https://sg.yunexpress.com/contact/) – regionale Kontakte
- [Deutsche Post: Mitteilungsblatt, Kapitel 4, Großempfänger, Zugänge](https://www.deutschepost.de/dam/jcr:4c156648-2f5f-4784-ad71-3fcb5c9982eb/dp-ddp-mtb-ge-zugaenge-122025.pdf) – YUN DE in Dreieich
- [Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper) – was Peek liest und zeigt, DHL- und DPD-Zeilen in YunExpress-Verläufen
:::
