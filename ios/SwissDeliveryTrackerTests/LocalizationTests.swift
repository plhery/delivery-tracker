import XCTest
@testable import SwissDeliveryTracker

@MainActor
final class LocalizationTests: XCTestCase {
    func testSharedTrackingMessagesPreserveOriginalNotesAndHideDiagnostics() {
        let localizer = Localizer()
        for language in AppLanguage.allCases {
            localizer.language = language
            XCTAssertEqual(localizer.eventDescription("Shipment exception"), localizer.text("event.carrier.exception"))
            XCTAssertEqual(localizer.eventDescription("Shipment arrived at a Dachser facility"), localizer.text("event.carrier.facilityArrival", ["carrier": "Dachser"]))
            XCTAssertEqual(localizer.eventDescription("Scanned by Sophie at dock 12"), "Scanned by Sophie at dock 12")
            XCTAssertEqual(localizer.trackingFailureMessage("carrier:input_required"), localizer.text("tracking.failure.input"))
            XCTAssertEqual(localizer.trackingFailureMessage("HTTP 403 private diagnostic"), localizer.text("detail.trackingUnavailable"))
            XCTAssertEqual(localizer.trackingFailureMessage("carrier:new_kind"), localizer.text("detail.trackingUnavailable"))
        }
    }

    func testDeliveryWindowRejectsInvalidOrReversedStarts() throws {
        let localizer = Localizer()
        localizer.language = .en
        let now = try XCTUnwrap(DateParser.deliveryDate("2026-09-09"))
        XCTAssertEqual(localizer.deliveryWindow(from: "2026-09-10", to: "2026-09-11", now: now), "tomorrow – Fri 11 sep")
        for from in [nil, "invalid", "2026-09-12", "2026-09-11"] as [String?] {
            XCTAssertEqual(localizer.deliveryWindow(from: from, to: "2026-09-11", now: now), "Fri 11 sep")
        }
    }

    func testEveryLanguageHasTheSameKeysAsEnglish() throws {
        let dictionaries = try localizationDictionaries()
        let englishKeys = Set(try XCTUnwrap(dictionaries["en"]).keys)

        XCTAssertEqual(Set(dictionaries.keys), Set(["en", "de", "fr", "it", "es", "pt", "pl"]))
        for language in ["de", "fr", "it", "es", "pt", "pl"] {
            XCTAssertEqual(Set(try XCTUnwrap(dictionaries[language]).keys), englishKeys, language)
        }
    }

    func testTranslationsPreserveInterpolationVariables() throws {
        let dictionaries = try localizationDictionaries()
        let english = try XCTUnwrap(dictionaries["en"])

        for language in ["de", "fr", "it", "es", "pt", "pl"] {
            let translated = try XCTUnwrap(dictionaries[language])
            for (key, englishValue) in english {
                XCTAssertEqual(
                    variables(in: translated[key] ?? ""),
                    variables(in: englishValue),
                    "\(language).\(key)"
                )
            }
        }
    }

    func testNotificationPresetCopyExistsInEveryLanguage() throws {
        let dictionaries = try localizationDictionaries()
        let keys = NotificationPreset.allCases.flatMap { [$0.titleKey, $0.descriptionKey] }

        for (language, values) in dictionaries {
            for key in keys {
                XCTAssertFalse(values[key, default: ""].isEmpty, "\(language).\(key)")
            }
        }
    }

    func testNativeWelcomeAndErrorCopyExistsInEveryLanguage() throws {
        let dictionaries = try localizationDictionaries()
        let keys = [
            "welcome.title",
            "welcome.subtitle",
            "welcome.feature.track",
            "welcome.feature.alerts",
            "welcome.feature.private",
            "add.requirement.dpdPostcodeHelp",
            "add.requirement.trackingUrlHelp",
            "auth.subtitle",
            "auth.emailOption",
            "native.configurationHelp",
            "native.appearance.title",
            "native.appearance.system",
            "native.appearance.light",
            "native.appearance.dark",
            "native.error.authenticationExpired",
            "native.auth.invalidResponse",
            "widget.galleryName",
            "widget.galleryDescription",
            "widget.settingTitle",
            "widget.settingDescription",
            "widget.disabledTitle",
            "widget.disabledDescription",
        ]

        for (language, values) in dictionaries {
            for key in keys {
                let value = values[key, default: ""]
                XCTAssertFalse(value.isEmpty, "\(language).\(key)")
                XCTAssertNotEqual(value, key, "\(language).\(key)")
            }
        }
    }

    func testNativeWelcomeExplainsCrossDeviceTrackingInEveryLanguage() throws {
        let dictionaries = try localizationDictionaries()
        let expected = [
            "en": "Track deliveries on the web and this iPhone.",
            "de": "Verfolge Lieferungen im Web und auf diesem iPhone.",
            "fr": "Suis tes livraisons sur le web et sur cet iPhone.",
            "it": "Segui le consegne sul web e su questo iPhone.",
        ]

        for (language, subtitle) in expected {
            XCTAssertEqual(dictionaries[language]?["welcome.subtitle"], subtitle, language)
        }
    }

    func testKnownNativeErrorsUseTheSelectedLanguage() {
        let localizer = Localizer()
        localizer.language = .de

        XCTAssertEqual(
            localizer.errorMessage(DeliveryAPIError.authenticationExpired),
            "Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an."
        )
        XCTAssertEqual(
            localizer.errorMessage(AuthenticationError.oauthCancelled),
            "Die Anmeldung wurde abgebrochen."
        )
    }

    func testServerErrorsAndAppEventsFollowTheSelectedLanguage() {
        let localizer = Localizer()
        localizer.language = .fr
        XCTAssertEqual(localizer.eventDescription("Tracking added"), "Ajouté à tes colis.")
        XCTAssertEqual(localizer.eventDescription("Original carrier scan"), "Original carrier scan")
        XCTAssertEqual(localizer.errorMessage(DeliveryAPIError.service("private SQL details")), localizer.text("error.generic"))
        XCTAssertEqual(localizer.errorMessage(AuthenticationError.server("Token has expired or is invalid")), localizer.text("error.invalidCode"))
    }

    func testPolishPluralForms() {
        let localizer = Localizer()
        localizer.language = .pl
        for count in [0, 1, 2, 4, 5, 12, 14, 21, 22, 25, 101, 102, 112] {
            let few = [2, 4, 22, 102].contains(count)
            let stamp = count == 1 ? "znaczek" : few ? "znaczki" : "znaczków"
            let parcel = count == 1 ? "przesyłka" : few ? "przesyłki" : "przesyłek"
            XCTAssertEqual(localizer.text("friends.stampCount", ["count": count]), "\(count) \(stamp)")
            XCTAssertEqual(localizer.text(count == 1 ? "passport.parcels.one" : "passport.parcels.many", ["count": count]), "\(count) \(parcel)")
        }
        XCTAssertEqual(localizer.text("time.daysAgo", ["count": 1]), "1 dzień temu")
    }

    func testNewLanguageNamesAndCopy() {
        let localizer = Localizer()
        for (language, name, title) in [(AppLanguage.es, "Español", "Entregas"), (.pt, "Português", "Entregas"), (.pl, "Polski", "Dostawy")] {
            localizer.language = language
            XCTAssertEqual(language.nativeName, name)
            XCTAssertEqual(localizer.text("native.deliveries"), title)
        }
    }

    func testReadableCalendarDatesInEveryLanguage() throws {
        let localizer = Localizer()
        let date = try XCTUnwrap(DateParser.deliveryDate("2026-09-12"))
        let cases: [(AppLanguage, String)] = [
            (.en, "Sat 12 sep"), (.de, "Sa 12 sept"),
            (.fr, "Sam 12 sept"), (.it, "Sab 12 set"),
        ]
        for (language, expected) in cases {
            localizer.language = language
            XCTAssertEqual(localizer.shortDate(date), expected)
            XCTAssertEqual(localizer.expectedDelivery("2026-09-12", now: date.addingTimeInterval(-3 * 86400)), expected)
        }
    }

    func testSingularCountsInEveryLanguage() {
        let localizer = Localizer()
        let cases: [(AppLanguage, String, String, String)] = [
            (.en, "stamp", "stamps", "Cancel 1 previous link"),
            (.fr, "timbre", "timbres", "Annuler 1 lien précédent"),
            (.de, "Briefmarke", "Briefmarken", "1 früheren Link widerrufen"),
            (.it, "francobollo", "francobolli", "Annulla 1 link precedente"),
        ]
        for (language, singular, plural, link) in cases {
            localizer.language = language
            XCTAssertEqual(localizer.text("friends.stampCount", ["count": 1]), "1 \(singular)")
            for count in [0, 2, 10] {
                XCTAssertEqual(localizer.text("friends.stampCount", ["count": count]), "\(count) \(plural)")
            }
            XCTAssertEqual(localizer.text("friends.cancelPrevious", ["count": 1]), link)
            XCTAssertEqual(localizer.text("friends.day", ["count": 1]), localizer.text("friends.day"))
        }
    }

    func testRelativeDeliveryDatesInEveryLanguage() throws {
        let localizer = Localizer()
        let now = try XCTUnwrap(DateParser.deliveryDate("2026-09-09"))
        let cases: [(AppLanguage, [String])] = [
            (.en, ["yesterday", "today", "tomorrow"]),
            (.de, ["gestern", "heute", "morgen"]),
            (.fr, ["hier", "aujourd’hui", "demain"]),
            (.it, ["ieri", "oggi", "domani"]),
            (.es, ["ayer", "hoy", "mañana"]),
            (.pt, ["ontem", "hoje", "amanhã"]),
            (.pl, ["wczoraj", "dziś", "jutro"]),
        ]
        for (language, labels) in cases {
            localizer.language = language
            for (index, value) in ["2026-09-08", "2026-09-09", "2026-09-10"].enumerated() {
                let day = try XCTUnwrap(DateParser.deliveryDate(value))
                let timestamp = try XCTUnwrap(Calendar.current.date(bySettingHour: 14, minute: 5, second: 0, of: day))
                XCTAssertEqual(localizer.expectedDelivery(value, now: now), labels[index])
                XCTAssertEqual(localizer.expectedDelivery("\(value) 14:00-16:00", now: now), "\(labels[index]), 14:00–16:00")
                XCTAssertEqual(localizer.expectedDelivery(DateParser.isoString(timestamp), now: now), "\(labels[index]), 14:05")
            }
            XCTAssertEqual(localizer.expectedDelivery("Awaiting estimate", now: now), "Awaiting estimate")
        }
    }

    func testRelativeDeliveryDatesUseCalendarDaysAtBoundaries() throws {
        let localizer = Localizer()
        localizer.language = .en
        let cases = [
            ("2026-01-01", "2025-12-31", "yesterday"),
            ("2026-12-31", "2027-01-01", "tomorrow"),
            ("2026-03-30", "2026-03-29", "yesterday"),
            ("2026-10-25", "2026-10-26", "tomorrow"),
        ]
        for (today, value, expected) in cases {
            let now = try XCTUnwrap(DateParser.deliveryDate(today))
            XCTAssertEqual(localizer.expectedDelivery(value, now: now), expected)
        }
        let day = try XCTUnwrap(DateParser.deliveryDate("2026-09-09"))
        let late = try XCTUnwrap(Calendar.current.date(bySettingHour: 23, minute: 55, second: 0, of: day))
        XCTAssertEqual(localizer.deliveryDate(day, now: late), "today")
        XCTAssertEqual(localizer.expectedDelivery("2026-09-11", now: late), "Fri 11 sep")
    }

    func testTrackingLocationFlagsPreserveCitiesAndAmbiguousAddresses() {
        let cases = [
            "France": "🇫🇷", "Germany": "🇩🇪", "Switzerland": "🇨🇭",
            "Zürich, Schweiz": "Zürich, 🇨🇭", "Bâle (Suisse)": "Bâle (🇨🇭)",
            "Milano, Italia": "Milano, 🇮🇹", "Paris; France": "Paris; 🇫🇷",
            "DE": "🇩🇪", "London, UK": "London, 🇬🇧", "CH ": "🇨🇭 ",
            "": "", "Warehouse": "Warehouse", "Paris": "Paris",
            "Buchs AG": "Buchs AG", "Basel, BS": "Basel, BS",
            "Wilmington, DE": "Wilmington, DE", "France distribution center": "France distribution center",
        ]
        for (location, expected) in cases {
            XCTAssertEqual(TrackingLocation.label(location), expected)
        }
    }

    private func localizationDictionaries() throws -> [String: [String: String]] {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "Localization", withExtension: "json"))
        return try JSONDecoder().decode([String: [String: String]].self, from: Data(contentsOf: url))
    }

    private func variables(in value: String) -> Set<String> {
        let expression = try! NSRegularExpression(pattern: "\\{\\{([A-Za-z0-9_.-]+)\\}\\}")
        let range = NSRange(value.startIndex..., in: value)
        return Set(expression.matches(in: value, range: range).compactMap { match in
            guard let range = Range(match.range(at: 1), in: value) else { return nil }
            return String(value[range])
        })
    }
}
