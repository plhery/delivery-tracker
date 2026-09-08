import XCTest
@testable import SwissDeliveryTracker

@MainActor
final class LocalizationTests: XCTestCase {
    func testEveryLanguageHasTheSameKeysAsEnglish() throws {
        let dictionaries = try localizationDictionaries()
        let englishKeys = Set(try XCTUnwrap(dictionaries["en"]).keys)

        XCTAssertEqual(Set(dictionaries.keys), Set(["en", "de", "fr", "it"]))
        for language in ["de", "fr", "it"] {
            XCTAssertEqual(Set(try XCTUnwrap(dictionaries[language]).keys), englishKeys, language)
        }
    }

    func testTranslationsPreserveInterpolationVariables() throws {
        let dictionaries = try localizationDictionaries()
        let english = try XCTUnwrap(dictionaries["en"])

        for language in ["de", "fr", "it"] {
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
            "fr": "Suivez vos livraisons sur le web et sur cet iPhone.",
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
        XCTAssertEqual(localizer.eventDescription("Tracking added"), "Ajouté à vos colis.")
        XCTAssertEqual(localizer.eventDescription("Original carrier scan"), "Original carrier scan")
        XCTAssertEqual(localizer.errorMessage(DeliveryAPIError.service("private SQL details")), localizer.text("error.generic"))
        XCTAssertEqual(localizer.errorMessage(AuthenticationError.server("Token has expired or is invalid")), localizer.text("error.invalidCode"))
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
