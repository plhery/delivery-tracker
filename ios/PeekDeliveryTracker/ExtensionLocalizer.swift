import Foundation

/// The app's copy in its extensions, which can't reach the app's Localizer. Each extension
/// bundles its own Localization.json; a key missing in one language falls back to English.
struct ExtensionLocalizer {
    let languageCode: String
    private let dictionaries: [String: [String: String]]

    static let bundledDictionaries: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "Localization", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let values = try? JSONDecoder().decode([String: [String: String]].self, from: data) else {
            return [:]
        }
        return values
    }()

    init(languageCode: String, dictionaries: [String: [String: String]] = bundledDictionaries) {
        self.languageCode = languageCode
        self.dictionaries = dictionaries
    }

    init(savedLanguageCode: String?) {
        self.init(languageCode: Self.languageCode(
            saved: savedLanguageCode,
            preferred: Locale.preferredLanguages,
            available: Set(Self.bundledDictionaries.keys)
        ))
    }

    /// The language saved by the app, else the first of the device's languages Peek speaks, else English.
    static func languageCode(saved: String?, preferred: [String], available: Set<String>) -> String {
        let preferred = preferred.map {
            $0.split(separator: "-").first.map(String.init)?.lowercased() ?? ""
        }
        return ([saved].compactMap { $0 } + preferred).first { available.contains($0) } ?? "en"
    }

    func text(_ key: String) -> String {
        dictionaries[languageCode]?[key]
            ?? dictionaries["en"]?[key]
            ?? key
    }
}
