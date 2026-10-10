---
title: YunExpress śledzenie przesyłki: statusy, kurier, kontakt
description: Paczka YunExpress z Chin: co znaczy numer YT, co mówią angielskie statusy, kto doręcza w Polsce i do kogo pisać, gdy paczka utknie.
slug: yunexpress-sledzenie
published: 2026-10-10
updated: 2026-10-10
---

YunExpress, pisany też Yun Express, to firma logistyczna z Shenzhen, która wysyła z Chin małe paczki dla sprzedawców internetowych, także tych z Allegro, Temu, SHEIN czy Amazona. Paczkę śledzisz numerem zaczynającym się od YT na stronie YunExpress, [yuntrack.com](https://www.yuntrack.com/), albo wklejasz go w pole powyżej. YunExpress nigdzie nie opisuje SMS-ów ani e-maili do odbiorców, więc numeru szukaj w e-mailu sklepu o wysyłce albo na stronie zamówienia.

## YunExpress numer śledzenia: YT i 16 cyfr

Yuntrack prosi o „your YunExpress tracking number (starting with YT)”, czyli numer zaczynający się od YT, i nie podaje jego długości. Peek rozpoznaje numer YunExpress po YT i 16 cyfrach, a jak odróżnić go od numerów innych firm, wyjaśnia poradnik [jaki kurier po numerze przesyłki](guide:tracking-number-formats). Przykłady z wymyślonymi cyframi:

| Numer | Czyj to numer |
| --- | --- |
| `YT1234567890123456` | YT i 16 cyfr: YunExpress. |
| `YT1234567890123` | YT i 13 cyfr: YTO Express, inny przewoźnik. Śledź go u niego. |
| `YT123456789012345` | YT i 15 cyfr: Peek nie rozpoznaje go jako YunExpress. Sprawdź, czy nie brakuje cyfry. |
| `LP12345678901234` | LP i 14 cyfr: numer logistyczny AliExpress, zobacz [Cainiao](carrier:cainiao). |

YunExpress podaje, że jeśli płacisz PayPalem, a sprzedawca przekazuje dane śledzenia do PayPala, status zobaczysz także w aplikacji PayPal, z powiadomieniami push.

Gdy paczkę przejmie przewoźnik w Polsce, może ona dostać drugi numer: yuntrack pokazuje go w kolumnie „Last Mile Tracking”, a na stronie szczegółów w „Additional Notes”. Jeśli yuntrack odpowiada `Not Found`, sprawdź litery YT i wszystkie 16 cyfr, a potem poproś sklep o potwierdzenie numeru. Nie masz numeru wcale? Zajrzyj do poradnika [gdzie znaleźć numer przesyłki](guide:find-tracking-number).

## YunExpress śledzenie: co znaczą statusy

Yuntrack działa tylko po angielsku, także w przeglądarce ustawionej na polski, i nie ma wyboru języka. Każdą paczkę przypisuje do jednej z sześciu zakładek: `Processing` (w przygotowaniu), `Transit` (w drodze), `Delivered` (doręczona), `Not Found` (nie znaleziono), `Alert` (ostrzeżenie) i `Returned` (zwrot). Pod spodem są kolejne skany, też po angielsku. Najczęstsze, mniej więcej w kolejności, w jakiej spotyka je paczka:

| YunExpress pisze | Co to znaczy dla Ciebie |
| --- | --- |
| `Shipment information received` | Sprzedawca przesłał dane paczki. YunExpress może jeszcze jej nie mieć. |
| `Shipment picked up` | YunExpress odebrał paczkę od sprzedawcy. |
| `The country of origin commences customs declaration.` | Zgłoszenie wywozowe w kraju nadania, jeszcze nie Twoja odprawa celna. |
| `International flight has departed` | Paczka leci do kraju docelowego. |
| `Start Customs Clearence` | Zaczyna się odprawa celna przywozowa (pisownia YunExpress). |
| `Customs inspection - Import` | Celnicy wybrali paczkę do kontroli. |
| `Clearance processing completed - Import` | Odprawa zakończona, paczka jedzie dalej. |
| `Delivered to local carrier` | Przekazana lokalnemu przewoźnikowi, nie Tobie. |
| `Shipment in transit to DHL` | W drodze do DHL, który przejmuje ostatni odcinek. |
| `Delivered by Mailbox` | Włożona do Twojej skrzynki pocztowej. |
| `POD available` | Linia od DPD: jest potwierdzenie doręczenia, paczka doręczona. |

Najwięcej zamieszania robi `Delivered to local carrier`: „Delivered” znaczy tu tylko, że YunExpress oddał paczkę przewoźnikowi w kraju docelowym. Potem pojawiają się już linie tego przewoźnika, również po angielsku. Jeśli na początku historii widzisz `Sender goods issue`, to linia od DPD: zapis danych utworzony, gdy paczka była jeszcze w Chinach, a nie problem z Twoim towarem.

`Transit` oznacza tylko, że paczka jest w drodze; gdzie dokładnie, mówi najnowsza linia. Czym jest `Alert`, YunExpress nie wyjaśnia: przeczytaj linię pod spodem i napisz do sklepu, jeśli nic się nie zmienia. W kodzie strony yuntrack jest też pasek postępu (`Pickup`, `Departed from origin`, `Arrived at destination`, `Local carrier on the way`, `Delivered successfully`). Jego `Pickup` to odebranie paczki od sprzedawcy w Chinach, a nie paczka „do odbioru” w punkcie. Ogólne etapy drogi paczki, od nadania po zwrot, opisuje [poradnik o statusach przesyłki](guide:tracking-statuses).

## Kto doręcza paczki YunExpress w Polsce

YunExpress wiezie paczki z Chin samolotem, a po odprawie celnej w kraju docelowym przekazuje je lokalnemu przewoźnikowi. Według własnych danych ma linię do Polski od 2018 roku, a od 2020 roku jest oficjalnym partnerem logistycznym Allegro. Kto doręcza w Polsce, na swoich stronach nie podaje; pisze tylko ogólnie o „premium global carrier networks”. W historiach YunExpress pojawiają się linie DHL (`Shipment in transit to DHL`) i DPD, ale bez zapisu, z którego kraju. Kto ma Twoją paczkę, pokazują linie po `Delivered to local carrier` i kolumna „Last Mile Tracking”. Jak śledzić paczkę dalej u przewoźnika w Polsce, opisuje poradnik o [śledzeniu paczki z Chin](guide:tracking-from-china).

Liczby prób doręczenia, awizo, czasu przechowania ani zmiany terminu YunExpress dla odbiorców nigdzie nie opisuje. Jeśli kurier Cię nie zastał, sprawdź zasady awizowania, przechowania i odbioru u lokalnego przewoźnika, którego nazwa stoi w śledzeniu.

**Punkty odbioru i automaty paczkowe.** Dla Europy YunExpress oferuje sprzedawcom dwie linie z odbiorem w punkcie. W jednej sam wybiera punkt albo automat paczkowy najbliżej kupującego, w promieniu 3 km (zwykle około 500 m), a gdy nie ma żadnego, wstrzymuje zamówienie. W drugiej punkt wybiera kupujący. Według niedatowanego artykułu paczka dociera do punktu średnio w 6–10 dni kalendarzowych od przyjęcia przez YunExpress, a śledzenie pokazuje adres punktu. Jakie to punkty i automaty w Polsce, YunExpress nie pisze.

## Paczka YunExpress nie dochodzi: co zrobić

Gdy paczka stoi w miejscu, spóźnia się, zginęła albo przyszła uszkodzona, YunExpress nie podaje odbiorcom ani kroków, ani formularza, ani terminu. Jego klientem jest sprzedawca, który podpisuje umowę, więc to sprzedawca może składać reklamację u przewoźnika. Napisz do sklepu albo serwisu, w którym było zamówienie, i podaj numer zamówienia oraz numer YT. Jeśli przez kilka dni nic się nie dzieje, przeczytaj, [dlaczego status przesyłki się nie zmienia](guide:tracking-not-updating).

Utknęła na `Customs inspection - Import`? Na blogu dla sprzedawców YunExpress pisze, że samo wytypowanie do kontroli nie oznacza długiego postoju; liczy się jej poziom. Kontrola dokumentów trwa zwykle od kilku dni roboczych do około tygodnia, prześwietlenie lub kontrola fizyczna często dodaje od jednego do dwóch tygodni, czasem z opłatami za magazyn lub kontrolę, a pobranie próbek albo ocena przez urząd od kilku tygodni do ponad miesiąca. To typowe przedziały, nie obietnice.

18 czerwca 2026 roku YunExpress napisał, że od 1 lipca 2026 roku UE zniesie zwolnienie z cła dla paczek o wartości do 150 euro i wprowadzi tymczasowe stałe cło „€3 per item”. Kto płaci je przy Twoim zamówieniu, YunExpress nie podaje. Co może Cię czekać w Polsce, wyjaśnia poradnik [paczka zatrzymana przez urząd celny](guide:customs).

Przy płatności PayPalem YunExpress przekazuje dane śledzenia do PayPala, jeśli sprzedawca to włączył, a tam, jak podaje YunExpress, służą one jako dowód w sporach. Jakie zasady wtedy obowiązują, sprawdź u PayPala.

Status mówi, że doręczona, a paczki nie ma? Strona śledzenia może pokazać potwierdzenie doręczenia, ale najpierw pyta o imię i nazwisko odbiorcy. Potem zapytaj lokalnego przewoźnika i sklep. Co jeszcze sprawdzić, podpowiada poradnik [paczka doręczona, a jej nie ma](guide:delivered-not-received). `Returned` znaczy, że paczka wraca. YunExpress nie publikuje zasad zwrotu dla odbiorców, więc zapytaj sklep.

## YunExpress kontakt: e-mail i telefon

Stan na 10 października 2026: YunExpress nie podaje dla odbiorców w Polsce ani numeru telefonu, ani formularza, ani biura. Polskiej strony nie ma: yunexpress.com jest tylko po angielsku, a adres yunexpress.pl nie działa. Opublikowane są:

- **E-mail:** info@yunexpress.com, jako „Customer Service” w stopce yunexpress.com, w godzinach 8:00–23:00, bez strefy czasowej. Nie wiadomo, czy odpowiada też odbiorcom. Strona główna obiecuje odpowiedzi po angielsku i chińsku, więc pisz po angielsku.
- **Telefon:** 400-8575-500 na yunexpress.cn, numer z Chin kontynentalnych. Nigdzie nie ma informacji, czy działa z zagranicy.
- **Kontakty regionalne:** tylko dla krajów Azji i dla Australii.

Pole „Feedback” na yuntrack dotyczy strony, a nie Twojej paczki. Zacznij więc od sklepu, który ma umowę z YunExpressem. Po przekazaniu paczki pytaj przewoźnika, którego nazwa stoi w śledzeniu, jego własnymi kanałami.

## Śledzenie paczki YunExpress w Peek

[Peek](/) rozpoznaje YT i 16 cyfr jako YunExpress i przyjmuje też linki z yuntrack.com. Sprawdza śledzenie co 10 minut, a co 2 minuty, gdy paczka jest w doręczeniu, pokazuje każdy skan na mapie i może Cię powiadomić, gdy zmieni się status. Widzisz status, historię, miejsce każdego skanu i godzinę doręczenia.

Gdy YunExpress podaje lokalnego przewoźnika i jego numer, Peek może śledzić paczkę dalej u tego przewoźnika, choć nie przy każdej paczce. Przy paczkach YunExpress nie pokazuje przewidywanej daty doręczenia ani punktu odbioru, pomija numery zamówienia i nie skontaktuje się za Ciebie z YunExpressem ani nie złoży reklamacji.

## Pytania o śledzenie YunExpress

### Co to za firma YunExpress?

To chińska firma logistyczna dla handlu internetowego: Shenzhen Qianhai YunExpress Logistics Co., Ltd., według własnych danych założona w 2014 roku w Shenzhen. Wysyła paczki sprzedawców do ponad 220 krajów i regionów, a od 2017 roku jest, jak podaje, polecanym partnerem logistycznym Amazona.

### Ile idzie paczka YunExpress do Polski?

Według szacunków YunExpress dla sprzedawców od 6 do 8 dni roboczych linią Standard Express i od 6 do 10 dni roboczych linią 特惠 z chińskiej strony YunExpress. Zwykle nie widzisz, którą linię wybrał sprzedawca, a kontrola celna może wydłużyć drogę.

### Czy YunExpress ma polską infolinię?

Nie: stan na 10 października 2026 YunExpress nie podaje numeru telefonu dla Polski. Na yunexpress.com jedynym kanałem jest e-mail info@yunexpress.com, po angielsku lub chińsku, a yunexpress.cn podaje chiński numer 400-8575-500, o którym nie wiadomo, czy działa z zagranicy. W sprawie paczki najpierw pisz do sklepu.

### Co oznacza DHL w śledzeniu YunExpress?

DHL przejmuje ostatni odcinek: linia `Shipment in transit to DHL` znaczy, że paczka jedzie do DHL. Numer, pod którym DHL ją prowadzi, może się pojawić w kolumnie „Last Mile Tracking” na yuntrack.

:::sources
- [YunExpress: Track & Trace Platform, Yuntrack](https://www.yuntrack.com/) – numer YT, tylko po angielsku (także w polskiej przeglądarce), Feedback
- [YunExpress: Tracking Results, Yuntrack](https://www.yuntrack.com/parcelTracking?id=YT1234567890123456) – zakładki, Last Mile Tracking, Not Found (wymyślony numer)
- [YunExpress: kod strony Yuntrack](https://www.yuntrack.com/static/js/app.239f901b375358352522.js) – Alert, pasek postępu, Additional Notes, potwierdzenie doręczenia
- [YunExpress: the Best Logistics Service Provider](https://www.yunexpress.com/) – firma, e-mail i godziny, angielski i chiński, sieci przewoźników
- [YunExpress: About Us](https://www.yunexpress.com/about-us) – 2014, ponad 220 krajów, linia do Polski od 2018, Allegro od 2020, Amazon od 2017
- [YunExpress: Privacy Policy](https://www.yunexpress.com/privacy-policy) – sprzedawca jako klient z umową
- [YunExpress: Partners](https://www.yunexpress.com/yun-ecosystem/partners) – platformy sprzedażowe
- [YunExpress: 云途物流与PayPal打通轨迹信息对接](https://www.yunexpress.com/newsroom/detail/2) – aplikacja PayPal, spory
- [YunExpress: Standard Express](https://www.yunexpress.com/our-solutions/b2c/33) – czas dostawy do Polski
- [YunExpress: 全球专线挂号（特惠带电）](https://www.yunexpress.com/our-solutions/b2c/7) – linia 特惠, Polska 6–10 dni roboczych
- [YunExpress: artykuł o odbiorze w punktach w Europie (po chińsku)](https://www.yunexpress.com/newsroom/detail/3) – dwie linie z odbiorem w punkcie, 3 km, 6–10 dni, adres punktu w śledzeniu
- [YunExpress: EU Customs Reform 2026 & YunExpress Service Updates](https://www.yunexpress.com/newsroom/detail/13) – tymczasowe cło UE od 1 lipca 2026
- [YunExpress: 為什麼你的包裹會被海關抽查？](https://hk.yunexpress.com/blog/2179/) – czas kontroli celnych
- [YunExpress: 云途物流YunExpress](https://www.yunexpress.cn/) – numer w Chinach kontynentalnych
- [YunExpress: Contact Us](https://sg.yunexpress.com/contact/) – kontakty regionalne
- [Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper) – co Peek odczytuje i pokazuje, linie DHL i DPD w historiach YunExpress
:::
