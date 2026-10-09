import XCTest
@testable import PeekDeliveryTracker

/// The language the widget and share extension speak, and what they show for a missing key.
final class ExtensionLocalizerTests: XCTestCase {
    private let available: Set<String> = ["en", "de", "fr", "it", "es", "pt", "pl"]

    private func language(saved: String? = nil, preferred: [String] = []) -> String {
        ExtensionLocalizer.languageCode(saved: saved, preferred: preferred, available: available)
    }

    func testTheLanguageSavedInTheAppWins() {
        XCTAssertEqual(language(saved: "pl", preferred: ["fr-FR", "de-DE"]), "pl")
        XCTAssertEqual(language(saved: "en", preferred: ["es-ES"]), "en")
    }

    func testAnUnsupportedSavedLanguageFallsThroughToTheDevice() {
        for saved in ["xx", "", "garbage", "pl-PL", "zh"] {
            XCTAssertEqual(language(saved: saved, preferred: ["it-IT"]), "it", saved)
            XCTAssertEqual(language(saved: saved), "en", saved)
        }
    }

    func testDeviceLanguagesMapToTheLanguagesPeekSpeaks() {
        XCTAssertEqual(language(preferred: ["es-ES"]), "es")
        XCTAssertEqual(language(preferred: ["es-419"]), "es")
        XCTAssertEqual(language(preferred: ["pt-PT"]), "pt")
        XCTAssertEqual(language(preferred: ["pt-BR"]), "pt")
        XCTAssertEqual(language(preferred: ["pl-PL"]), "pl")
        XCTAssertEqual(language(preferred: ["de"]), "de")
        XCTAssertEqual(language(preferred: ["FR-ca"]), "fr")
    }

    func testTheFirstDeviceLanguagePeekSpeaksWins() {
        XCTAssertEqual(language(preferred: ["zh-Hans", "ja-JP", "pl-PL", "de-DE"]), "pl")
    }

    func testEnglishWhenNothingIsSupported() {
        XCTAssertEqual(language(), "en")
        XCTAssertEqual(language(preferred: ["zh-Hans", "ja-JP"]), "en")
        XCTAssertEqual(ExtensionLocalizer.languageCode(saved: "pl", preferred: ["pl-PL"], available: []), "en")
    }

    func testRegionAndScriptVariantsAndOddValuesDoNotCrash() {
        for preferred in ["zh-Hant-TW", "sr-Latn-RS", "zh-Hans-CN", "-", "--", "", "en_US", "x-private"] {
            _ = language(preferred: [preferred])
        }
        XCTAssertEqual(language(preferred: ["zh-Hant-TW", "sr-Latn-RS", "-", ""]), "en")
        XCTAssertEqual(language(preferred: ["zh-Hant-TW", "it-Latn-IT"]), "it")
    }

    func testAMissingKeyFallsBackToEnglishThenToTheKey() {
        let dictionaries = [
            "en": ["shared": "Shared", "englishOnly": "English only"],
            "pl": ["shared": "Wspólne"],
        ]
        let polish = ExtensionLocalizer(languageCode: "pl", dictionaries: dictionaries)
        XCTAssertEqual(polish.text("shared"), "Wspólne")
        XCTAssertEqual(polish.text("englishOnly"), "English only")
        XCTAssertEqual(polish.text("missing.key"), "missing.key")

        let unknown = ExtensionLocalizer(languageCode: "xx", dictionaries: dictionaries)
        XCTAssertEqual(unknown.text("shared"), "Shared")
        XCTAssertEqual(ExtensionLocalizer(languageCode: "pl", dictionaries: [:]).text("shared"), "shared")
    }

    func testTheBundledCatalogDrivesTheChoice() throws {
        let bundled = ExtensionLocalizer.bundledDictionaries
        XCTAssertEqual(Set(bundled.keys), available)

        let polish = ExtensionLocalizer(savedLanguageCode: "pl")
        XCTAssertEqual(polish.languageCode, "pl")
        XCTAssertEqual(polish.text("shareExtension.title"), try XCTUnwrap(bundled["pl"]?["shareExtension.title"]))
        XCTAssertNotEqual(polish.text("shareExtension.title"), "shareExtension.title")

        let device = ExtensionLocalizer.languageCode(saved: nil, preferred: Locale.preferredLanguages, available: available)
        XCTAssertEqual(ExtensionLocalizer(savedLanguageCode: nil).languageCode, device)
        XCTAssertEqual(ExtensionLocalizer(savedLanguageCode: "garbage").languageCode, device)
    }
}
