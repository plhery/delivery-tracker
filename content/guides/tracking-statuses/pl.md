---
title: Statusy przesyłek – co oznaczają, krok po kroku
description: Co oznaczają statusy przesyłek: od „przygotowana przez nadawcę” i „w tranzycie” przez odprawę celną po „wydana do doręczenia”, awizo i zwrot.
slug: statusy-przesylek-co-oznaczaja
picture: Kręta trasa z odhaczonymi przystankami (etykieta z kodem kreskowym, magazyn, samolot), furgonetka na obecnym przystanku, dom jeszcze przed nią i pędzący Pip.
published: 2026-10-09
updated: 2026-10-09
---

Status przesyłki to ostatni skan przewoźnika w kilku słowach i zwykle niczego od Ciebie nie wymaga. „Przygotowana przez nadawcę” znaczy, że przewoźnik nie ma jeszcze Twojej paczki, „w trasie” albo „w tranzycie”, że jest gdzieś między dwoma skanami, a „wydana do doręczenia”, że jedzie już do Ciebie. Działać musisz tylko w kilku sytuacjach: po nieudanej próbie doręczenia, gdy paczka czeka w automacie albo punkcie, gdy trzeba zapłacić należności celne i gdy status brzmi „doręczona”, a paczki nie ma.

## Przez jakie etapy przechodzi paczka?

Każda paczka mija te same przystanki, a paczka z zagranicy jeszcze trzy.

:::journey
- label | Przygotowana przez nadawcę | Przewoźnik ma dane paczki, ale nie samą paczkę.
- warehouse | W trasie | Odebrana, potem z oddziału do sortowni i dalej, a między skanami cisza.
- plane | Opuściła kraj nadania | Tylko z zagranicy. W samolocie nikt nie skanuje.
- customs | Odprawa celna | Tylko z zagranicy. Czasem trzeba coś dopłacić.
- handover | Przewoźnik w Polsce | Tylko z zagranicy. Jego skany bywają tylko na jego stronie.
- truck | Wydana do doręczenia | Jest już w aucie kuriera, zwykle dotrze dziś.
- locker | Gotowa do odbioru | Czeka w automacie paczkowym, punkcie albo na poczcie.
- home | Doręczona | Trafiła do Twoich rąk albo tam, gdzie przewoźnik uznaje ją za doręczoną.
:::

## Co oznaczają statusy InPost i FedEx?

Te same etapy, inne słowa. InPost inaczej opisuje paczkę do automatu Paczkomat, a inaczej paczkę kurierską:

| Etap | InPost, paczka do automatu Paczkomat | InPost, paczka kurierska | FedEx |
| --- | --- | --- | --- |
| Etykieta gotowa | `Przygotowana przez Nadawcę.` | jak obok | `Utworzono etykietę` |
| Nadana | `Paczka nadana w automacie Paczkomat.`, `Nadana w PaczkoPunkcie.` albo `Odebrana od Nadawcy.` | jak obok | `Mamy Twoją paczkę` |
| W drodze | `Przyjęta w oddziale InPost.`, `W trasie.`, `Przyjęta w Sortowni.` | jak obok | `W drodze`, `W oddziale` |
| Wydana do doręczenia | `Przekazano do doręczenia.` | `W doręczeniu.` | `Wydano do doręczenia` |
| Gotowa do odbioru | `Umieszczona w automacie Paczkomat (odbiorczym).` | `Oczekuje na odbiór.` (w PaczkoPunkcie, po awizo kuriera) | – |
| Doręczona | `Dostarczona.` | `Dostarczona.` | – |

Polski słowniczek FedEx nie opisuje statusów „gotowa do odbioru” i „doręczona”, dlatego w tych wierszach jest kreska.

## „Przygotowana przez nadawcę”: czy przewoźnik ma już paczkę?

Nie. Sprzedawca wydrukował etykietę i przesłał dane, nic więcej. InPost przy `Przygotowana przez Nadawcę.` pisze, że paczka „wkrótce zostanie przekazana w nasze ręce”, a jeszcze wcześniej może pokazać `Przesyłka utworzona.`, czyli przesyłkę, która „nie jest gotowa do nadania”. FedEx przy `Utworzono etykietę` wyjaśnia, że nadawca dopiero przygotowuje paczkę do przekazania. Status zmienia się na `Mamy Twoją paczkę`, gdy kurier FedEx ją odbierze albo nadawca zostawi ją w oddziale.

Paczka nadana w automacie też nie od razu rusza: `Paczka nadana w automacie Paczkomat.` znaczy, że czeka, aż doręczyciel wyjmie ją ze skrytki i zawiezie do oddziału InPost.

Jeśli pierwszy status długo się nie zmienia, napisz do sprzedawcy, nie do przewoźnika: paczka wciąż jest u sprzedawcy. Tak samo radzi Cainiao przy zamówieniach z Chin bez danych śledzenia: zamówienie „jest przetwarzane”, a po szczegóły trzeba się zwrócić do sprzedawcy.

## Przesyłka w trasie albo w tranzycie: co to znaczy?

Przewoźnik ma Twoją paczkę gdzieś w swojej sieci. Nie znaczy to, że akurat jedzie: według FedEx paczka `W drodze` jest „w jednym z naszych pojazdów lub placówek”. InPost opisuje tę część po kolei: `Przyjęta w oddziale InPost.` znaczy, że paczka dotarła do jednego z centrów logistycznych, `W trasie.` to przejazd między oddziałami, `Przyjęta w Sortowni.` to postój w Sortowni Głównej, gdzie „zatrzymuje się na chwilę większość przesyłek InPost”, a `Przyjęta w Oddziale Docelowym.` znaczy, że paczka jest już w Twoim mieście.

Między skanami cisza jest normalna:

- FedEx uważa ponad 24 godziny bez skanu za nic niezwykłego.
- UPS na długich trasach może nie zeskanować paczki aż do sortowni docelowej.
- Poczta Polska przy listach poleconych pokazuje tylko dzień nadania i dzień doręczenia, bez drogi przesyłki.

### Ile paczka jest w drodze?

DPD podaje, że krajową paczkę standardowo doręcza następnego dnia roboczego, a gwarantuje 3 dni robocze; wiele zależy od usługi wybranej przez nadawcę. Poczta Polska, operator wyznaczony do 2035 roku, ma w rozporządzeniu cele dla zwykłych paczek pocztowych: 93% paczek najszybszej kategorii ma dotrzeć w terminie D+3, a 98% pozostałych w terminie D+5, gdzie D to dzień nadania.

Status `Przyjęta w Oddziale Docelowym.` to dobry znak: według InPost paczka „wkrótce trafi do rąk doręczyciela”. Cisza dłuższa niż czas podany przez przewoźnika? Zobacz, [dlaczego status przesyłki się nie zmienia](guide:tracking-not-updating).

## Paczka z zagranicy: „opuściła kraj nadania”, cło i przewoźnik w Polsce

- **Opuściła kraj nadania.** Paczka jest w drodze samolotem, statkiem albo pociągiem. Po drodze nikt jej nie skanuje, więc do następnego skanu, zwykle już w kraju docelowym, bywa cicho.
- **Odprawa celna.** Każdą przesyłkę pocztową z towarem spoza Unii Europejskiej trzeba zgłosić do urzędu celnego, bez względu na wartość, ale paczkę do 150 euro Poczta Polska zgłasza za Ciebie. Gdy brakuje danych albo opis towaru jest niejasny, paczka może na jakiś czas utknąć w magazynie pocztowo-celnym. Po odprawie jedzie do doręczenia, a należności Poczta Polska pobiera przy doręczeniu albo przed odbiorem. Działaj tylko wtedy, gdy poczta albo urząd celny o coś poprosi. Ile zapłacisz, łącznie z cłem 3 euro za każdy rodzaj produktu, wyjaśnia poradnik [paczka zatrzymana przez urząd celny](guide:customs).
- **Przewoźnik w Polsce.** Ostatni odcinek często przejmuje inna firma. Przy ekonomicznej wysyłce Cainiao pisze, że jego śledzenie kończy się na przekazaniu „przewoźnikowi w kraju/regionie docelowym”, a o dalsze statusy trzeba pytać tego przewoźnika. Paczek od Temu, AliExpress i Shein DPD nie przekierowuje; gdy już je ma, możesz je najwyżej skierować do punktu DPD Pickup na trasie kuriera. Zamawiasz w Chinach? Zobacz, jak [śledzić paczkę z Chin](guide:tracking-from-china).

## Czy „wydana do doręczenia” znaczy, że paczka będzie dziś?

Zwykle tak, ale przewoźnicy ujmują to różnie:

- **InPost, paczka do automatu Paczkomat:** `Przekazano do doręczenia.` znaczy, że przesyłka trafi do Ciebie „najpóźniej w najbliższym dniu roboczym”. Doręczyciele rozwożą paczki nawet do późnych godzin wieczornych, więc miej włączony telefon.
- **InPost, paczka kurierska:** `W doręczeniu.` znaczy, że paczka jest „na ostatnim etapie podróży”, u kuriera.
- **FedEx:** `Wydano do doręczenia` to paczka zeskanowana i umieszczona w pojeździe „w celu doręczenia tego dnia”, a przedział godzin pokazuje strona śledzenia.
- **DPD:** po wydaniu paczki do doręczenia w aplikacji DPD Mobile i na tt.dpd.com.pl pojawia się numer telefonu kuriera. Gdy przy zamówieniu był wybór przedziału godzin, paczka przyjedzie w wybranym. W sobotę DPD doręcza tylko paczki z usługą Sobota.

Dwa statusy łatwo pomylić. `Przyjęta w Oddziale Docelowym.` znaczy, że paczka jest w Twoim mieście, ale jeszcze nie u doręczyciela. A `W doręczeniu.` pojawia się u InPost także wtedy, gdy kurier Cię nie zastał: w opisie zobaczysz wtedy, że kolejna próba będzie w następnym dniu roboczym.

[Peek](/) sprawdza paczkę nawet co 2 minuty, gdy jest już na ostatnim odcinku, a powiadomienia możesz ograniczyć do dnia doręczenia (ustawienie „Tylko w dniu dostawy”).

## Awizo i nieudana próba doręczenia: co teraz?

Tu musisz coś zrobić: nikt nie odebrał paczki albo kurier nie mógł jej doręczyć.

:::steps
- Przeczytaj powiadomienie | SMS, e-mail, aplikacja albo awizo w skrzynce: gdzie jest paczka i do kiedy czeka.
- Sprawdź termin | Od 48 godzin w automacie Paczkomat do 14 dni na poczcie, liczonych w godzinach, dniach albo dniach roboczych.
- Zmień dostawę | Tylko na stronie lub w aplikacji przewoźnika: inny dzień, adres, sąsiad, automat paczkowy albo punkt.
- Odbierz paczkę | Kodem odbioru albo w aplikacji. W DPD z Twoim kodem odbierze ją też ktoś inny, jeśli nie trzeba nic podpisywać.
:::

| Przewoźnik | Po nieudanej próbie | Jak długo czeka |
| --- | --- | --- |
| InPost, kurier | Druga próba w następnym dniu roboczym, potem zwrot do nadawcy. Wcześniej możesz za darmo przekierować paczkę do automatu Paczkomat | – |
| InPost, PaczkoPunkt | `Oczekuje na odbiór.`, czyli awizo w PaczkoPunkcie | 3 dni robocze |
| InPost, automat Paczkomat | – | 48 godzin; dodatkowe 24 godziny za 7,99 zł w aplikacji InPost Mobile |
| DPD | W DPD Mobile albo na mojapaczka.dpd.com.pl: inna data (do 3 dni roboczych), adres, sąsiad, safeplace albo DPD Pickup | Punkt i automat DPD Pickup: 2 pełne dni robocze, bez przedłużenia |
| Poczta Polska, kurier Pocztex | SMS, e-mail albo powiadomienie w aplikacji (bez tych danych awizo w skrzynce), przypomnienie drugiego dnia | 7 dni na poczcie, potem zwrot |
| Poczta Polska, paczka pocztowa | Awizo w skrzynce; w miastach powyżej 100 000 mieszkańców paczkę odbierzesz od następnego dnia | 14 dni, licząc od dnia po zostawieniu awizo |
| Pocztex PUNKT i AUTOMAT | – | Placówka pocztowa 7 dni, punkt w sklepie (np. Żabka) 3 dni, automat 72 godziny, bez przedłużenia |
| Mondial Relay w Polsce | – | Automat 48 godzin (72 w środku budynku), punkt 72 godziny |

Przy paczce pocztowej cięższej niż 2 kg albo przesyłce z należnościami celnymi rozporządzenie pozwala Poczcie Polskiej od razu zostawić awizo, bez próby doręczenia do drzwi. Przedłużenie w InPost kupisz tylko przed końcem pierwotnych 48 godzin: żółty przycisk Przedłuż pojawia się w aplikacji 12 godzin przed terminem (24 godziny w punktach z ograniczonymi godzinami otwarcia).

> SMS o nieudanej próbie doręczenia z linkiem do „ustalenia nowego terminu” albo do dopłaty to znany schemat oszustwa. InPost zapewnia, że nigdy nie wysyła SMS-ów o dopłatach, a Pocztex, że nie wysyła linków do płatności i nie prosi SMS-em o dane karty. Zmieniaj dostawę tylko na stronie lub w aplikacji przewoźnika, a podejrzany SMS prześlij na numer 8080 (CERT Polska).

## „Gotowa do odbioru”: gdzie jest paczka?

W automacie paczkowym, punkcie albo na poczcie, do terminu z tabeli wyżej. InPost pisze `Umieszczona w automacie Paczkomat (odbiorczym).` i wysyła e-mail oraz powiadomienie w aplikacji InPost Mobile albo SMS z kodem odbioru. W PaczkoPunkcie zobaczysz `Czeka na odbiór w PaczkoPunkcie.` i prośbę o odbiór w ciągu 3 dni. Pocztex przysyła SMS z numerem przesyłki, adresem punktu, terminem odbioru i jednorazowym kodem odbioru. Paczkę z DPD Pickup odbierzesz w aplikacji DPD Mobile albo kodem z e-maila.

Gdy w wybranym automacie Paczkomat nie ma miejsca, kurier zostawia paczkę w automacie tymczasowym, najdalej 2 km w linii prostej od wybranego (`Paczka magazynowana w tymczasowym automacie Paczkomat`). Czeka tam 1 pełny dzień kalendarzowy, a jeśli jej nie odbierzesz, jedzie do pierwotnie wybranego automatu (`Paczka w drodze do pierwotnie wybranego automatu Paczkomat`).

Nie idź po paczkę przed tym statusem albo powiadomieniem od przewoźnika: dopiero wtedy masz kod i znasz adres.

## Czy „doręczona” znaczy, że paczka jest u Ciebie?

Nie zawsze. Znaczy, że kurier zeskanował ją jako wydaną albo zostawioną:

- **Domownikowi.** Jeśli na liście przewozowym nie ma dopisku „do rąk własnych”, DPD uznaje za skuteczne doręczenie dorosłemu domownikowi albo innej uprawnionej osobie.
- **We wskazanym miejscu.** W DPD Mobile możesz sam wybrać sąsiada albo safeplace. Kurierowi Pocztex możesz przez telefon wskazać miejsce tuż przy adresie, jeśli nadawca podał Twój numer; za to, co stanie się z paczką potem, Poczta Polska już nie odpowiada.
- **W punkcie, nie u Ciebie.** Poczta Polska przyznaje, że przy paczce do punktu odbioru status „doręczono” bywa błędnym skanem: kurier dostarczył ją do punktu, a poprawny status to „dostarczono do punktu odbioru”. Zgłoś to infolinii Poczty Polskiej: 801 333 444 z telefonu stacjonarnego albo +48 438 420 600 z komórki.

Nie ma paczki? Sprawdź w pełnej historii śledzenia, gdzie i komu ją wydano, a potem przeczytaj poradnik [paczka doręczona, a jej nie ma](guide:delivered-not-received).

## „Możliwe opóźnienie” albo „brak możliwości doręczenia”: czy paczka zaginęła?

Nie. FedEx przy `Wyjątek w doręczeniu` pisze, że doręczenie opóźnia nieprzewidziane zdarzenie, na przykład opóźnienie w odprawie, zła pogoda, strajk albo nieobecność odbiorcy, i że „w tej chwili nie musisz podejmować żadnych działań”. `Opóźnienie` znaczy u FedEx, że paczka najprawdopodobniej nie dotrze przed szacowaną datą. InPost przy `Możliwe opóźnienie doręczenia.` przeprasza i zapowiada nowy termin w kolejnych wiadomościach.

Przyjrzyj się bliżej, gdy chodzi o adres albo pieniądze. `Brak możliwości doręczenia.` u InPost dotyczy dnia dzisiejszego i zwykle podaje powód: błędne lub niepełne dane adresowe, nieznany odbiorca, odbiorca nie mieszka pod adresem, brak skrzynki pocztowej albo brak gotówki na pobranie. Jeśli zamiast powodu opis mówi, że paczka wyruszyła w drogę powrotną, to już zwrot. Jeśli adres jest zły, napisz od razu do sprzedawcy.

## Zwrot do nadawcy: dlaczego paczka wraca?

Przewoźnicy podają takie powody: paczka nieodebrana w terminie, błędny lub niepełny adres, odmowa przyjęcia, nieopłacone należności, uszkodzenie. Zwrot nie zawsze tak się nazywa:

- **InPost `Upłynął termin odbioru.`** Paczka wróci do nadawcy, ale możesz ją jeszcze odebrać, jeśli dotrzesz do automatu przed doręczycielem.
- **InPost `Powrót do oddziału.`** Kurier drugi raz Cię nie zastał i paczka jest już w drodze powrotnej.
- **FedEx `W trakcie zwrotu do oddziału FedEx`.** Odbiorca odmówił przyjęcia, na przykład z powodu uszkodzenia albo braku możliwości zapłaty; o dalszym losie paczki decyduje nadawca.

Odmowa działa od razu: w Pocztex odmówiona paczka wraca do nadawcy niezwłocznie, a odmowa zapłaty należności za przesyłkę liczy się jak odmowa przyjęcia. Przy paczce spoza Unii Poczta Polska też przypomina, że możesz odmówić jej przyjęcia. Przesyłka nieodebrana z poczty w terminie wraca do nadawcy, a zwrot InPost trafia do miejsca nadania albo na adres zwrotny. Gdy paczka już wraca, poproś sprzedawcę o ponowną wysyłkę albo zwrot pieniędzy.

:::sources
- [InPost: statusy przesyłek (API ShipX)](https://api-shipx-pl.easypack24.net/v1/statuses?lang=pl_PL) – nazwy i opisy statusów
- [InPost: Jak przedłużyć czas odbioru paczki z automatu Paczkomat?](https://inpost.pl/pomoc-jak-przedluzyc-termin-odbioru-paczki-w-paczkomacie) – 48 godzin, 24 godziny za 7,99 zł
- [InPost: Co się stanie, jeśli nie odbiorę paczki od kuriera InPost?](https://inpost.pl/pomoc-co-sie-stanie-jesli-nie-odbiore-paczki-od-kuriera-inpost) – druga próba, przekierowanie
- [InPost: Czym jest magazynowanie w automacie Paczkomat?](https://inpost.pl/pomoc-czym-jest-magazynowanie-w-automacie-paczkomat) – tymczasowy automat
- [InPost: Co się stanie, jeżeli Odbiorca nie odbierze mojej paczki?](https://inpost.pl/pomoc-co-sie-stanie-jezeli-odbiorca-nie-odbierze-mojej-paczki) – dokąd wraca zwrot
- [InPost: Uwaga, cyberzagrożenie](https://inpost.pl/aktualnosci-uwaga-cyberzagrozenie-0) – SMS-y o dopłatach
- [DPD Polska: najczęściej zadawane pytania](https://www.dpd.com/pl/pl/najczesciej-zadawane-pytania-faq/) – czas doręczenia, numer kuriera, zmiana dostawy, DPD Pickup
- [DPD Polska: Regulamin świadczenia usług w obrocie krajowym](https://www.dpd.com/wp-content/uploads/sites/260/2025/01/RUK_01.01.2024PL.pdf) – doręczenie domownikowi
- [Poczta Polska: Regulamin usługi Pocztex w obrocie krajowym dla klienta biznesowego od 24 sierpnia 2026](https://www.poczta-polska.pl/wp-content/uploads/2026/08/Regulamin-swiadczenia-uslugi-Pocztex-w-obrocie-krajowym-dla-klienta-biznesowego-obowiazuje-od-24.08.2026-r.pdf) – awizo kuriera, PUNKT, AUTOMAT, odmowa, dyspozycja telefoniczna
- [Poczta Polska: Odbiór w punkcie, FAQ](https://odbiorwpunkcie.poczta-polska.pl/faq/) – „doręczono” zamiast „dostarczono do punktu odbioru”, infolinia, brak przedłużenia
- [Poczta Polska: e-monitoring](https://emonitoring.poczta-polska.pl/) – listy polecone
- [Poczta Polska: Regulamin obsługi przesyłek zagranicznych w zakresie przedstawienia do kontroli i zgłoszenia do procedury celnej](https://www.poczta-polska.pl/wp-content/uploads/2025/09/Regulamin-obslugi-przesylek-zagranicznych-w-zakresie-przedstawienia-do-kontroli-i-zgloszenia-do-procedury-celnej.pdf) – numer infolinii z telefonu stacjonarnego i z komórki
- [Poczta Polska: Uwaga na fałszywe wiadomości Pocztex](https://www.poczta-polska.pl/news/uwaga-na-falszywe-wiadomosci-pocztex-grozna-kampania-phishingowa/) – SMS o nieudanym doręczeniu, numer 8080
- [Poczta Polska: Zmiany w opłatach dla przesyłek spoza UE od 1 lipca 2026](https://www.poczta-polska.pl/news/zmiany-w-oplatach-dla-przesylek-spoza-unii-europejskiej-od-1-lipca-2026-r/) – cło 3 euro, magazyn pocztowo-celny, odmowa
- [Poczta Polska: operator wyznaczony do 2035 roku](https://www.poczta-polska.pl/news/prezes-uke-zdecydowal-poczta-polska-operatorem-wyznaczonym-do-2035-roku/) – usługi powszechne
- [Rozporządzenie w sprawie warunków wykonywania usług powszechnych (Dz.U. 2020 poz. 1026)](https://api.sejm.gov.pl/eli/acts/DU/2020/1026/text.html) – awizo, 14 dni, paczki powyżej 2000 g, miasta powyżej 100 000 mieszkańców
- [Rozporządzenie zmieniające (Dz.U. 2024 poz. 1745)](https://api.sejm.gov.pl/eli/acts/DU/2024/1745/text.html) – termin odbioru, wskaźniki D+3 i D+5
- [KAS: Informacja dla odbiorców przesyłek pocztowych spoza Unii Europejskiej](https://www.mazowieckie.kas.gov.pl/mazowiecki-urzad-celno-skarbowy-w-warszawie/wiadomosci/komunikaty/-/asset_publisher/i3dT/content/informacja-dla-odbiorcow-przesylek-pocztowych-spoza-unii-europejskiej) – zgłoszenie celne każdej przesyłki, próg 150 euro, należności przy doręczeniu
- [FedEx: Co oznacza mój status monitorowania?](https://www.fedex.com/pl-pl/customer-support/faq/receiving/tracking-questions/fedex-tracking-status-meaning.html) – statusy po polsku
- [FedEx: Package not moving](https://www.fedex.com/en-us/customer-support/faqs/receiving/tracking-questions/package-not-moving.html) – 24 godziny bez skanu
- [UPS: Understanding tracking status](https://www.ups.com/us/en/support/tracking-support/where-is-my-package/understanding-tracking-status) – długie trasy
- [Mondial Relay: ile dni masz na odbiór paczki z automatu lub punktu (FAQ po francusku)](https://www.mondialrelay.fr/faq/recevoir-un-colis/combien-de-jours-ai-je-pour-retirer-mon-colis-en-locker-ou-point-relais/) – Polska 48 i 72 godziny
- [Cainiao: teksty strony śledzenia po polsku](https://lang.alicdn.com/mcms/global-track/0.0.10/global-track.json) – wysyłka ekonomiczna, brak danych
:::
