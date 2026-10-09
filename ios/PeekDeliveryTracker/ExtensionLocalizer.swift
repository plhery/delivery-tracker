import Foundation

/// The app's copy in its extensions, which can't reach the app's Localizer. Each extension
/// bundles its own Localization.json; a key missing in one language falls back to English.
struct ExtensionLocalizer {
    let languageCode: String

    private static let dictionaries: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "Localization", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let values = try? JSONDecoder().decode([String: [String: String]].self, from: data) else {
            return [:]
        }
        return values
    }()

    init(languageCode: String) {
        self.languageCode = languageCode
    }

    /// The language saved by the app, else the first of the device's languages Peek speaks, else English.
    init(savedLanguageCode: String?) {
        let preferred = Locale.preferredLanguages.map {
            $0.split(separator: "-").first.map(String.init)?.lowercased() ?? ""
        }
        languageCode = ([savedLanguageCode].compactMap { $0 } + preferred)
            .first { Self.dictionaries[$0] != nil } ?? "en"
    }

    func text(_ key: String) -> String {
        Self.dictionaries[languageCode]?[key]
            ?? Self.dictionaries["en"]?[key]
            ?? key
    }
}
