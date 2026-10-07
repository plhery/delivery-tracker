import Combine
import Foundation

struct CarrierRequirement: Codable, Hashable, Sendable {
    enum Field: String, Codable, Sendable {
        case trackingURL = "trackingUrl"
        case dpdPostcode
    }

    let field: Field
    let validator: String?
    let whenTrackingNumber: String?
    let optional: Bool?
    let label: String
    let type: String
    let placeholder: String?
    let help: String?
    let pattern: String?
    let maxLength: Int?
    let inputMode: String?
    let autoComplete: String?

    func normalizedValue(_ rawValue: String) -> String {
        var value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if inputMode == "numeric" {
            value = value.filter(\.isNumber)
        } else if validator == "paackPostcode" {
            value = value.uppercased().filter { !$0.isWhitespace }
        } else if takesAnyPostcode {
            // As the country writes it: capitals, one space between groups.
            value = value.uppercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
        }
        if let maxLength {
            value = String(value.prefix(maxLength))
        }
        return value
    }

    /// The carrier delivers abroad too and takes any country's postcode.
    var takesAnyPostcode: Bool { validator == "internationalPostcode" }

    /// The value a field keeps while it is typed: `normalizedValue`, with the
    /// space a postcode in two groups ("SW1A 1AA") needs before its second group.
    func typedValue(_ rawValue: String) -> String {
        let value = normalizedValue(rawValue)
        guard takesAnyPostcode, rawValue.last?.isWhitespace == true,
              !value.isEmpty, value.count < maxLength ?? .max else { return value }
        return value + " "
    }

    /// Number keys first where the example is all digits; letters stay one tap away.
    func startsWithNumberKeys(example: String?) -> Bool {
        takesAnyPostcode && example?.contains(where: \.isLetter) != true
    }

    /// The parcel can be saved without it; a value that is typed is still checked.
    var isOptional: Bool { optional == true }

    func accepts(_ rawValue: String) -> Bool {
        var value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if inputMode == "numeric" {
            value = value.filter(\.isNumber)
        }
        guard !value.isEmpty else { return false }
        if let maxLength, value.count > maxLength { return false }
        guard let pattern, !pattern.isEmpty else { return true }
        return value.range(of: pattern, options: .regularExpression) != nil
    }

    func isSatisfied(by rawValue: String) -> Bool {
        if isOptional, rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return true }
        return accepts(rawValue)
    }
}

struct CarrierDefinition: Codable, Sendable {
    struct Tracking: Codable, Sendable {
        let mode: String
        let adapter: String?
        let requirements: [CarrierRequirement]?
        /// Present when the carrier can recognize a number; no two carriers share a rank.
        var recognitionRank: Int? = nil
        var browserRecognitionRank: Int? = nil
    }

    struct LinkRule: Codable, Sendable {
        let domains: [String]
        let params: [String]?
        let path: String?
        let pathPattern: String?
        let fragment: String?
        let detectFromNumber: Bool?
        let keepsCapabilityURL: Bool?

        enum CodingKeys: String, CodingKey {
            case domains, params, path, pathPattern, fragment, detectFromNumber
            case keepsCapabilityURL = "keepsCapabilityUrl"
        }
    }

    struct DetectionRule: Codable, Sendable {
        let pattern: String
        let rawPattern: String?
        let confidence: String
        let checksum: String?
        /// Low-confidence number evidence: the carrier is listed first among suggestions.
        let preferred: Bool?
    }

    var displayName: String
    let displayNames: [String: String]?
    /// Other names the carrier is known by, searched by the carrier picker.
    var aliases: [String]? = nil
    /// Where it delivers under its own name, home country first.
    var countries: [String]? = nil
    let trackingSiteName: String?
    let color: String
    let selectable: Bool
    let timezone: String
    let tracking: Tracking
    let trackingURLTemplate: String?
    let linkRules: [LinkRule]
    let detectionRules: [DetectionRule]

    enum CodingKeys: String, CodingKey {
        case displayName, displayNames, aliases, countries, trackingSiteName, color, selectable, timezone, tracking
        case linkRules, detectionRules
        case trackingURLTemplate = "trackingUrlTemplate"
    }
}

struct CarrierMatch: Equatable, Sendable {
    enum Confidence: String, Sendable {
        case high, low, none
    }

    let carrier: CarrierID
    let confidence: Confidence
    let candidates: [CarrierID]
    /// Candidates a `preferred` rule backs with number evidence, listed first.
    var preferred: [CarrierID] = []
}

struct TrackingInputMatch: Equatable, Sendable {
    enum Source: String, Sendable {
        case number, link, text, none
    }

    let trackingNumber: String
    let carrier: CarrierID
    let confidence: CarrierMatch.Confidence
    let candidates: [CarrierID]
    let trackingURL: String?
    let source: Source
}

/// Carrier recognition in the Add sheet: a shape several carriers share is
/// checked with them once the number is settled (the field loses focus, a
/// paste, a scan, a shared number), never on each keystroke. It never holds
/// the Add button: after saving, the first sync asks the same carriers again.
/// Mirrors `carrierCheck` in `src/lib/carrierPicker.ts`.
struct CarrierRecognition: Equatable, Sendable {
    enum Status: Equatable, Sendable {
        /// Nothing to report: the number is not settled, or needs no check.
        case idle
        /// No carrier can be asked about this shape; routing looks it up after saving.
        case unasked
        /// The carriers being asked, while they answer.
        case asking([CarrierID])
        /// One carrier knows the number.
        case recognized(CarrierID)
        /// Unrelated carriers all know it: the user chooses.
        case several([CarrierID])
        /// Every carrier answered and none knows it yet, which is normal for a new label.
        case notFound([CarrierID])
        /// No carrier could answer; the first sync asks again.
        case failed([CarrierID])
    }

    /// The normalized number as it stood when it was last settled.
    var settledNumber: String?
    /// The server's answer for a settled number.
    var answer: CarrierDetectionResponse?

    /// Only a number no direct carrier claims with confidence is worth asking about. The
    /// check keeps running when a carrier is picked by hand meanwhile: its answer
    /// then only says when another carrier has the parcel.
    static func applies(to input: TrackingInputMatch, amazon: Bool, demo: Bool) -> Bool {
        !demo && !amazon && ((input.confidence == .low && input.carrier == .unknown)
            || input.carrier == .internationalPost)
    }

    /// The number to ask about: the settled one, while it is still the number in
    /// the field and has no answer yet.
    func request(for number: String, applies: Bool) -> String? {
        guard applies, !number.isEmpty, settledNumber == number, answer?.trackingNumber != number else { return nil }
        return number
    }

    /// `asked` is the carriers the check asks, predicted before the answer arrives.
    func status(for number: String, applies: Bool, asked: [CarrierID]) -> Status {
        guard applies, !number.isEmpty else { return .idle }
        guard let answer, answer.trackingNumber == number else {
            guard settledNumber == number else { return .idle }
            return .asking(asked)
        }
        if answer.carrier != .unknown && answer.carrier != .internationalPost { return .recognized(answer.carrier) }
        if let choices = answer.recognized, choices.count > 1 { return .several(choices) }
        let answered = answer.asked ?? []
        if let providers = answer.providers, !providers.isEmpty {
            return answer.trackingFound == true || providers.contains(where: { $0.outcome == .inputRequired || $0.outcome == .noHistory })
                ? .notFound(answered) : .failed(answered)
        }
        if answered.isEmpty { return .unasked }
        if (answer.unanswered?.count ?? 0) >= answered.count { return .failed(answered) }
        return .notFound(answered)
    }
}

struct ParcelTrackingLink: Identifiable, Sendable {
    enum Role: Sendable { case active, waiting, history }
    let carrier: CarrierID
    let name: String
    let url: URL
    let role: Role
    var id: String { "\(role):\(url.absoluteString)" }
}

enum CarrierCatalogRefreshResult: Equatable, Sendable {
    case updated
    case notModified
    case skipped
    case failed
}

final class CarrierCatalog: ObservableObject, @unchecked Sendable {
    typealias Loader = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    private struct Contract: Codable {
        let carriers: [String: CarrierDefinition]
        enum CodingKeys: String, CodingKey { case carriers = "x-carriers" }
    }

    private struct CacheRecord: Codable {
        let etag: String?
        let contract: Contract
    }

    private enum CatalogError: Error {
        case invalidContract
    }

    static let shared = CarrierCatalog()
    @Published private(set) var definitions: [CarrierID: CarrierDefinition] {
        didSet {
            detections.removeAllObjects()
            parsedInputs.removeAllObjects()
        }
    }

    /// Views ask for the same input's result many times per render and keystroke.
    private final class Memo<Value>: @unchecked Sendable {
        let value: Value
        init(_ value: Value) { self.value = value }
    }
    private let detections = NSCache<NSString, Memo<CarrierMatch>>()
    private let parsedInputs = NSCache<NSString, Memo<TrackingInputMatch>>()
    private static let expressions = NSCache<NSString, NSRegularExpression>()

    private static let refreshInterval: TimeInterval = 15 * 60
    private static let maximumResponseBytes = 512 * 1_024
    private static let defaultLoader: Loader = { request in
        try await URLSession.shared.data(for: request)
    }

    private let cacheURL: URL?
    private let loader: Loader
    private var cachedETag: String?
    private var lastRefreshAttempt: Date?

    init(
        bundle: Bundle = .main,
        cacheURL: URL? = CarrierCatalog.defaultCacheURL(),
        loader: @escaping Loader = CarrierCatalog.defaultLoader
    ) {
        self.cacheURL = cacheURL
        self.loader = loader

        if let cacheURL,
           let cached = Self.cachedContract(at: cacheURL) {
            definitions = cached.definitions
            cachedETag = cached.etag
        } else {
            definitions = Self.bundledDefinitions(in: bundle)
            cachedETag = nil
        }
    }

    init(
        data: Data,
        cacheURL: URL? = nil,
        loader: @escaping Loader = CarrierCatalog.defaultLoader
    ) throws {
        let contract = try JSONDecoder().decode(Contract.self, from: data)
        definitions = try Self.validatedDefinitions(contract)
        self.cacheURL = cacheURL
        self.loader = loader
        cachedETag = nil
    }

    @MainActor
    func refresh(
        from apiBaseURL: URL,
        force: Bool = false,
        now: Date = Date()
    ) async -> CarrierCatalogRefreshResult {
        if !force,
           let lastRefreshAttempt,
           now.timeIntervalSince(lastRefreshAttempt) < Self.refreshInterval {
            return .skipped
        }
        lastRefreshAttempt = now

        var request = URLRequest(url: apiBaseURL.appending(path: "api/carriers"))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let cachedETag {
            request.setValue(cachedETag, forHTTPHeaderField: "If-None-Match")
        }

        do {
            let (data, response) = try await loader(request)
            guard let response = response as? HTTPURLResponse else { return .failed }
            if response.statusCode == 304 { return .notModified }
            guard response.statusCode == 200,
                  data.count <= Self.maximumResponseBytes else { return .failed }

            let contract = try JSONDecoder().decode(Contract.self, from: data)
            let refreshed = try Self.validatedDefinitions(contract)
            let etag = response.value(forHTTPHeaderField: "ETag")
            definitions = refreshed
            cachedETag = etag
            saveCache(contract: contract, etag: etag)
            return .updated
        } catch {
            return .failed
        }
    }

    func info(for carrier: CarrierID, language: AppLanguage? = nil) -> CarrierDefinition {
        var definition = definitions[carrier] ?? definitions[.unknown] ?? Self.fallbackDefinitions[.unknown]!
        if let language, let name = definition.displayNames?[language.rawValue] {
            definition.displayName = name
        }
        return definition
    }

    var selectableCarriers: [CarrierID] {
        definitions.compactMap { $0.value.selectable ? $0.key : nil }
            .sorted { info(for: $0).displayName.localizedCaseInsensitiveCompare(
                info(for: $1).displayName
            ) == .orderedAscending }
    }

    func tracksAutomatically(_ carrier: CarrierID) -> Bool {
        info(for: carrier).tracking.mode == "automatic"
    }

    /// Carriers the detect route asks at once.
    static let maximumRecognitions = 5
    /// Brands with several catalog networks ("DPD" is `dpd` and `dpd-fr`), as in
    /// Universal Parcel Scraper's catalog networks.
    private static let networkBrands = ["dhl", "dpd", "gls", "hermes"]

    static func networkBrand(_ carrier: CarrierID) -> String? {
        networkBrands.first { carrier.rawValue == $0 || carrier.rawValue.hasPrefix("\($0)-") }
    }

    /// The carriers the detect route asks about an ambiguous number, best first:
    /// number evidence, then the catalog's recognition rank. Mirrors
    /// `recognitionAskedCarriers`; the detection golden file keeps them in step.
    func recognitionCandidates(for raw: String, browser: Bool = false) -> [CarrierID] {
        let match = detect(raw)
        let unknownPostalCarrier = match.carrier == .internationalPost
        guard match.confidence == .low || unknownPostalCarrier else { return [] }
        var candidates = match.candidates
        var preferred = match.preferred
        if unknownPostalCarrier {
            let number = Self.normalize(raw)
            let printed = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            // The generic postal match already checked S10. Recover low rules
            // it hid; each carrier still has to confirm the whole identity.
            let postalMatches = definitions.compactMap { carrier, definition -> (CarrierID, Bool)? in
                guard let rule = definition.detectionRules.first(where: { rule in
                    rule.confidence == "low" && (rule.checksum == nil || rule.checksum == "s10")
                        && Self.matches(number, pattern: rule.pattern)
                        && (rule.rawPattern.map { Self.matches(printed, pattern: $0) } ?? true)
                }) else { return nil }
                return (carrier, rule.preferred == true)
            }
            candidates = postalMatches.map { $0.0 }
            preferred = postalMatches.filter { $0.1 }.map { $0.0 }
        }
        func rank(_ carrier: CarrierID) -> Int? {
            browser ? definitions[carrier]?.tracking.browserRecognitionRank : definitions[carrier]?.tracking.recognitionRank
        }
        // A preferred carrier that cannot be asked (DPD France) keeps its brand's
        // other networks out: DPD's guest API also answers for DPD France parcels.
        let shadowed = Set(preferred.filter { rank($0) == nil }.compactMap(Self.networkBrand))
        let eligible = candidates.filter { carrier in
            guard let definition = definitions[carrier], rank(carrier) != nil,
                  definition.tracking.mode == "automatic", definition.tracking.adapter != "universal" else { return false }
            if browser && requirements(for: carrier, trackingNumber: raw).contains(where: { $0.optional != true }) { return false }
            return Self.networkBrand(carrier).map { !shadowed.contains($0) } ?? true
        }
        // Ranks are unique, so the order does not depend on the catalog's key order.
        let ordered = eligible.sorted { left, right in
            let leftPreferred = preferred.contains(left)
            if leftPreferred != preferred.contains(right) { return leftPreferred }
            return (rank(left) ?? 0) > (rank(right) ?? 0)
        }
        return Array(ordered.prefix(browser ? 2 : Self.maximumRecognitions))
    }

    func discoveryCandidates(for raw: String) -> [CarrierID] {
        let http = recognitionCandidates(for: raw)
        return http + recognitionCandidates(for: raw, browser: true).filter { !http.contains($0) }
    }

    func isAmazonTrackingNumber(_ raw: String) -> Bool {
        guard let pattern = definitions[.amazonLogistics]?.detectionRules.first?.pattern else { return false }
        return Self.matches(Self.normalize(raw), pattern: pattern)
    }

    func requiresAmazonAccount(_ carrier: CarrierID, trackingNumber: String = "") -> Bool {
        carrier != .amazonShipping && (carrier == .amazonLogistics || isAmazonTrackingNumber(trackingNumber))
    }

    static func amazonMarketplace(_ number: String) -> String {
        let normalized = normalize(number)
        // TBA names no country; its Canadian and Mexican siblings do.
        if normalized.hasPrefix("TBC") { return "ca" }
        if normalized.hasPrefix("TBM") { return "com.mx" }
        let domains = ["FR": "fr", "DE": "de", "AT": "de", "BE": "com.be", "UK": "co.uk", "GB": "co.uk",
            "IT": "it", "ES": "es", "PT": "es", "NL": "nl", "IE": "ie", "PL": "pl", "SE": "se", "TR": "com.tr"]
        return domains[String(normalized.prefix(2))] ?? "com"
    }

    static func amazonOrdersURL(_ number: String) -> URL {
        URL(string: "https://www.amazon.\(amazonMarketplace(number))/gp/your-account/order-history")!
    }

    static func amazonShippingURL(_ number: String) -> URL {
        let normalized = normalize(number)
        let domains = ["IT": "it", "ES": "es", "UK": "co.uk", "GB": "co.uk", "TB": "com"]
        let domain = domains[String(normalized.prefix(2))] ?? "fr"
        return URL(string: "https://track.amazon.\(domain)/tracking/\(urlEncode(normalized))")!
    }

    func trackingHintKey(for carrier: CarrierID) -> String {
        if requiresAmazonAccount(carrier) { return "add.amazonAccount" }
        return tracksAutomatically(carrier) ? "add.autoSync" : "add.linkSync"
    }

    /// One postcode per country, shown as the example in a field that takes any country's.
    static let postcodeExamples: [String: String] = {
        guard let url = Bundle.main.url(forResource: "PostcodeExamples", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let examples = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return examples
    }()

    /// The example in a carrier's field. A national carrier states its own
    /// postcode; one that takes any country's leaves it out and shows the
    /// device's region, or the carrier's own country when that has no example.
    func postcodeExample(
        for carrier: CarrierID,
        requirement: CarrierRequirement,
        region: String? = Locale.current.region?.identifier
    ) -> String? {
        if let placeholder = requirement.placeholder, !placeholder.isEmpty { return placeholder }
        guard requirement.field == .dpdPostcode else { return nil }
        return ([region].compactMap { $0?.uppercased() } + (info(for: carrier).countries ?? []))
            .lazy.compactMap { Self.postcodeExamples[$0] }.first
    }

    func requirements(for carrier: CarrierID, trackingNumber: String) -> [CarrierRequirement] {
        let normalized = Self.normalize(trackingNumber)
        return (info(for: carrier).tracking.requirements ?? []).filter { requirement in
            guard let pattern = requirement.whenTrackingNumber else { return true }
            return Self.matches(normalized, pattern: pattern)
        }
    }

    func detect(_ raw: String) -> CarrierMatch {
        let number = Self.normalize(raw)
        guard !number.isEmpty else {
            return CarrierMatch(carrier: .unknown, confidence: .none, candidates: [])
        }
        let printed = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if let memo = detections.object(forKey: printed as NSString) { return memo.value }
        let match = detectNormalized(number, printed: printed)
        detections.setObject(Memo(match), forKey: printed as NSString)
        return match
    }

    private func detectNormalized(_ number: String, printed: String) -> CarrierMatch {
        var matches: [(carrier: CarrierID, confidence: CarrierMatch.Confidence, preferred: Bool)] = []
        for (carrier, definition) in definitions {
            for rule in definition.detectionRules {
                guard Self.matches(number, pattern: rule.pattern) else { continue }
                if let rawPattern = rule.rawPattern, !Self.matches(printed, pattern: rawPattern) { continue }
                if rule.checksum == "mondial-relay" && !Self.isValidMondialRelayBarcode(number) { continue }
                if rule.checksum == "s10" && !Self.isValidS10(number) { continue }
                if rule.checksum == "hermes" && !Self.isValidHermesParcelNumber(number) { continue }
                if rule.checksum == "gls" && !Self.isValidGlsParcelNumber(number) { continue }
                if rule.checksum == "dhl-express" && !Self.isValidDhlExpressWaybill(number) { continue }
                if rule.checksum == "tnt" && !Self.isValidTntConsignmentNumber(number) { continue }
                if rule.checksum == "poczta-polska" && !Self.isValidPocztaPolskaBarcode(number) { continue }
                if rule.checksum == "correos-spain" && !Self.isValidCorreosSpainCheckLetter(number) { continue }
                if rule.checksum == "dpd" && !Self.isValidDpdParcelNumber(number) { continue }
                matches.append((carrier, rule.confidence == "high" ? .high : .low, rule.preferred == true))
                break
            }
        }
        let high = matches.filter { $0.confidence == .high }
        let ranked = high.isEmpty ? matches : high
        // Number evidence first; the dictionary has no order, so sort each group.
        let preferred = ranked.filter(\.preferred).map(\.carrier).sorted { $0.rawValue < $1.rawValue }
        let candidates = preferred + ranked.filter { !$0.preferred }.map(\.carrier).sorted { $0.rawValue < $1.rawValue }
        if high.count == 1 {
            return CarrierMatch(carrier: high[0].carrier, confidence: .high, candidates: candidates, preferred: preferred)
        }
        return CarrierMatch(
            carrier: .unknown,
            confidence: matches.isEmpty ? .none : .low,
            candidates: candidates,
            preferred: preferred
        )
    }

    func parse(_ raw: String) -> TrackingInputMatch {
        let input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return Self.emptyMatch }
        if let memo = parsedInputs.object(forKey: input as NSString) { return memo.value }
        let match = parseTrimmed(input)
        parsedInputs.setObject(Memo(match), forKey: input as NSString)
        return match
    }

    private func parseTrimmed(_ input: String) -> TrackingInputMatch {
        for pasted in Self.matches(in: input, pattern: "https?://[^\\s<>\\\"']+") {
            let cleaned = pasted
                .trimmingCharacters(
                    in: CharacterSet.whitespacesAndNewlines
                        .union(CharacterSet(charactersIn: "<>'\"()[],;.!?"))
                )
            guard let components = URLComponents(string: cleaned),
                  let host = components.host?.lowercased() else { continue }
            var matchingRules: [(carrier: CarrierID, rule: CarrierDefinition.LinkRule)] = []
            for (carrier, definition) in definitions {
                for rule in definition.linkRules where rule.domains.contains(where: {
                    host == $0 || host.hasSuffix(".\($0)")
                }) {
                    if let pattern = rule.pathPattern,
                       Self.matches(in: components.path, pattern: pattern, caseInsensitive: true).isEmpty { continue }
                    matchingRules.append((carrier, rule))
                }
            }
            func specificity(_ rule: CarrierDefinition.LinkRule) -> Int {
                rule.domains.filter { host == $0 || host.hasSuffix("." + $0) }.map(\.count).max() ?? 0
            }
            matchingRules.sort {
                let left = specificity($0.rule), right = specificity($1.rule)
                return left == right ? $0.carrier.rawValue < $1.carrier.rawValue : left > right
            }
            for firstMatch in matchingRules {
                let queryValue = components.queryItems?.first { item in
                    firstMatch.rule.params?.contains {
                        $0.caseInsensitiveCompare(item.name) == .orderedSame
                    } == true
                }?.value
                var pathValue: String?
                if let path = firstMatch.rule.path {
                    pathValue = Self.capture(components.path, pattern: path)
                }
                let fragmentValue = firstMatch.rule.fragment.flatMap {
                    Self.capture(components.fragment ?? "", pattern: $0, caseInsensitive: true)
                }
                let candidate = (queryValue ?? pathValue ?? fragmentValue ?? "")
                    .split(whereSeparator: { $0 == "," || $0 == "|" }).first.map(String.init) ?? ""
                if valid(candidate) {
                    let detected = detect(candidate)
                    if firstMatch.rule.detectFromNumber == true, detected.confidence == .high {
                        return makeMatch(candidate, source: .link)
                    }
                    let suggested = matchingRules.filter { detected.candidates.contains($0.carrier) }
                    let uniqueSuggestions = Set(suggested.map { $0.carrier })
                    let selected = detected.confidence == .high
                        ? matchingRules.first(where: { $0.carrier == detected.carrier }) ?? firstMatch
                        : (uniqueSuggestions.count == 1 ? suggested[0] : firstMatch)
                    return TrackingInputMatch(
                        trackingNumber: candidate,
                        carrier: selected.carrier,
                        confidence: .high,
                        candidates: [selected.carrier],
                        trackingURL: selected.rule.keepsCapabilityURL == true ? cleaned : nil,
                        source: .link
                    )
                }
            }
            let decoded = cleaned.removingPercentEncoding ?? cleaned
            if let recognized = recognizedNumber(in: decoded) {
                return makeMatch(recognized, source: .link)
            }
        }

        if let recognized = recognizedNumber(in: input) {
            return makeMatch(recognized, source: input == recognized ? .number : .text)
        }

        if let labelled = Self.capture(input, pattern: Self.labelledNumberPattern, caseInsensitive: true) {
            // A sentence can end right after its number.
            let keyword = labelled.replacingOccurrences(of: "[.-]+$", with: "", options: .regularExpression)
            if Self.validInText(keyword) { return makeMatch(keyword, source: .text) }
        }
        if !input.contains("://"), valid(input) { return makeMatch(input, source: .number) }
        return Self.emptyMatch
    }

    func trackingLinks(for parcel: Parcel, language: AppLanguage) -> [ParcelTrackingLink] {
        if requiresAmazonAccount(parcel.carrier, trackingNumber: parcel.trackingNumber) {
            return [ParcelTrackingLink(carrier: .amazonLogistics,
                name: info(for: .amazonLogistics, language: language).displayName,
                url: Self.amazonOrdersURL(parcel.trackingNumber), role: .active)]
        }
        let links = carrierTrackingLinks(for: parcel, language: language)
        let lookupNumber = parcel.carrierData?.originalCarrier != nil && parcel.carrierData?.activeTrackingCarrier != nil
            ? parcel.carrierData?.activeTrackingNumber?.nonEmpty ?? parcel.trackingNumber : parcel.trackingNumber
        let number = Self.urlEncode(lookupNumber)
        // A carrier that answered the same check keeps the link, even when its clock sent the result elsewhere.
        guard let provider = parcel.carrierData?.trackingProvider, parcel.carrierData?.carrierAnswered != true else { return links }
        let raw: String
        switch provider {
        case "17TRACK": raw = "https://t.17track.net/en#nums=\(number)"
        case "ParcelsApp": raw = "https://parcelsapp.com/en/tracking/\(number)"
        case "Ship24": raw = "https://www.ship24.com/tracking?p=\(number)"
        case "UPU": raw = "https://globaltracktrace.ptc.post/gtt.web/Search.aspx"
        // Public entry point, without guessing a private/session-specific URL.
        case "Postal Ninja": raw = "https://postal.ninja/en/track"
        default: return links
        }
        guard let url = localizedURL(raw, carrier: .unknown, language: language) else { return links }
        let primary = ParcelTrackingLink(carrier: .unknown, name: provider, url: url, role: .active)
        return [primary] + links.filter { $0.role != .active && $0.url != url }
    }

    private func carrierTrackingLinks(for parcel: Parcel, language: AppLanguage) -> [ParcelTrackingLink] {
        if let originalCarrier = parcel.carrierData?.originalCarrier,
           let originalNumber = parcel.carrierData?.originalTrackingNumber?.nonEmpty {
            var delivery = parcel
            delivery.carrier = parcel.activeTrackingCarrier
            delivery.trackingNumber = parcel.carrierData?.activeTrackingNumber?.nonEmpty ?? parcel.trackingNumber
            delivery.carrierData = nil
            if delivery.carrier != parcel.carrier || delivery.trackingNumber != parcel.trackingNumber { delivery.trackingURL = nil }
            var original = delivery
            original.carrier = originalCarrier
            original.trackingNumber = originalNumber
            original.trackingURL = parcel.carrierData?.originalTrackingURL
            let history = trackingLinks(for: original, language: language).map {
                ParcelTrackingLink(carrier: $0.carrier, name: $0.name, url: $0.url, role: .history)
            }
            return trackingLinks(for: delivery, language: language) + history
        }
        if !Self.supportsSwissPostHandoff(parcel.trackingNumber) {
            let carrier = parcel.activeTrackingCarrier
            let number = parcel.carrierData?.activeTrackingNumber?.nonEmpty ?? parcel.trackingNumber
            let definition = info(for: carrier, language: language)
            // Replace obsolete generated links saved by earlier app versions.
            let savedPostNLURL = parcel.trackingURL.flatMap { URL(string: $0) }
            let obsoletePostNLLink = parcel.carrier == .springGDS
                && savedPostNLURL?.host?.lowercased() == "postnl.post"
                && savedPostNLURL?.path.hasPrefix("/details/") == true
            let savedURL = requiresAmazonAccount(carrier, trackingNumber: number) || carrier == .internationalPost || obsoletePostNLLink || carrier != parcel.carrier
                || number != parcel.trackingNumber ? nil : parcel.trackingURL
            guard let raw = savedURL
                    ?? Self.renderTrackingURL(
                        definition.trackingURLTemplate,
                        carrier: carrier,
                        trackingNumber: number
                    ),
                  let url = localizedURL(raw, carrier: carrier, language: language) else { return [] }
            return [ParcelTrackingLink(
                carrier: carrier,
                name: definition.trackingSiteName ?? definition.displayName,
                url: url,
                role: .active
            )]
        }

        let active = parcel.activeTrackingCarrier
        let ready = parcel.swissPostReady || active == .swissPost
        return [CarrierID.aliexpress, .swissPost].compactMap { carrier in
            let definition = info(for: carrier, language: language)
            guard let template = definition.trackingURLTemplate,
                  let url = localizedURL(
                    template.replacingOccurrences(
                        of: "{trackingNumber}", with: Self.urlEncode(parcel.trackingNumber)
                    ),
                    carrier: carrier,
                    language: language
                  ) else { return nil }
            let role: ParcelTrackingLink.Role = carrier == active
                ? .active
                : (carrier == .swissPost && !ready ? .waiting : .history)
            return ParcelTrackingLink(carrier: carrier, name: definition.trackingSiteName ?? definition.displayName, url: url, role: role)
        }.sorted { left, _ in left.role == .active }
    }

    private func recognizedNumber(in text: String) -> String? {
        let patterns = [
            "\\b(?:[A-Z]{2}[\\s.-]*[0-9](?:[\\s.-]?[0-9]){9}|TBA[\\s.-]*[0-9](?:[\\s.-]?[0-9]){11})\\b",
            "\\b\\d{4}/\\d{8}\\b",
            "\\b\\d{26}\\b",
            "\\bH\\d{15,19}\\b",
            "\\b1Z[A-Z0-9]{16}\\b",
            "\\b1G[A-Z0-9]{10}\\b",
            "\\b[A-Z]{2}\\s*\\d(?:[\\s.-]?\\d){8}\\s*[A-Z]{2}\\b",
            "\\b(?:JJD|JVGL)[A-Z0-9]{8,}\\b",
            "\\b\\d(?:[\\s.-]?\\d){9,19}\\b",
        ]
        for pattern in patterns {
            for candidate in Self.matches(in: text, pattern: pattern, caseInsensitive: true) {
                if detect(candidate).confidence == .high { return candidate.trimmingCharacters(in: .whitespaces) }
            }
        }
        return nil
    }

    private func makeMatch(_ number: String, source: TrackingInputMatch.Source) -> TrackingInputMatch {
        let result = detect(number)
        return TrackingInputMatch(
            trackingNumber: number,
            carrier: result.carrier,
            confidence: result.confidence,
            candidates: result.candidates,
            trackingURL: nil,
            source: source
        )
    }

    private func localizedURL(_ raw: String, carrier: CarrierID, language: AppLanguage) -> URL? {
        guard var components = URLComponents(string: raw) else { return nil }
        if carrier == .swissPost {
            var items = components.queryItems ?? []
            items.removeAll { $0.name == "lang" }
            let siteLanguage = [AppLanguage.en, .de, .fr, .it].contains(language) ? language : .en
            items.append(URLQueryItem(name: "lang", value: siteLanguage.rawValue))
            components.queryItems = items
        } else if components.host == "t.17track.net" || components.host == "parcelsapp.com" {
            // Parcels has no Polish page; 17TRACK supports all app languages.
            let siteLanguage = components.host == "parcelsapp.com" && language == .pl ? AppLanguage.en : language
            components.path = components.path.replacingOccurrences(
                of: "^/[a-z]{2}(?=/|$)", with: "/\(siteLanguage.rawValue)", options: .regularExpression
            )
        }
        return components.url
    }

    static func normalize(_ raw: String) -> String {
        let value = raw.uppercased()
        guard let separators = expression("[\\s.-]") else { return value }
        return separators.stringByReplacingMatches(
            in: value,
            range: NSRange(value.startIndex..., in: value),
            withTemplate: ""
        )
    }

    static func format(_ raw: String, carrier: CarrierID? = nil) -> String {
        let value = normalize(raw)
        if carrier == .postlogistics {
            let printed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if matches(printed, pattern: "^[0-9]{11}$") {
                return "\(printed.prefix(8))-\(printed.suffix(3))"
            }
            return printed
        }
        if matches(value, pattern: "^99990\\d{8}$") {
            return "\(value.prefix(3)).\(value.dropFirst(3).prefix(2)).\(value.dropFirst(5))"
        }
        if matches(value, pattern: "^\\d{18}$") {
            return "\(value.prefix(2)).\(value.dropFirst(2).prefix(2)).\(value.dropFirst(4).prefix(6)).\(value.dropFirst(10))"
        }
        return value
    }

    static func isValidMondialRelayBarcode(_ value: String) -> Bool {
        guard matches(value, pattern: "^[0-9]{26}$") else { return false }
        let digits = value.compactMap(\.wholeNumberValue)
        func check(_ range: Range<Int>) -> Int {
            let sum = digits[range].reversed().enumerated().reduce(0) { $0 + $1.element * (2 + $1.offset % 6) }
            let remainder = 11 - sum % 11
            return remainder >= 10 ? 0 : remainder
        }
        let sequence = digits[10] * 10 + digits[11]
        let count = digits[12] * 10 + digits[13]
        return sequence > 0 && sequence <= count && check(0..<14) == digits[14] && check(15..<25) == digits[25]
    }

    /// Hermes Germany's legacy 14-digit numbers: a modulo-10 check digit weighted 3, 1, 3, … from the left.
    static func isValidHermesParcelNumber(_ value: String) -> Bool {
        guard matches(value, pattern: "^[0-9]{14}$") else { return false }
        let digits = value.compactMap(\.wholeNumberValue)
        let sum = digits[0..<13].enumerated().reduce(0) { $0 + $1.element * ($1.offset % 2 == 0 ? 3 : 1) }
        return (10 - sum % 10) % 10 == digits[13]
    }

    /// GLS 12-digit parcel numbers: a modulo-10 check digit weighted 3, 1, 3, … from the right, plus one.
    static func isValidGlsParcelNumber(_ value: String) -> Bool {
        guard matches(value, pattern: "^[0-9]{12}$") else { return false }
        let digits = value.compactMap(\.wholeNumberValue)
        let sum = digits[0..<11].reversed().enumerated().reduce(1) { $0 + $1.element * ($1.offset % 2 == 0 ? 3 : 1) }
        return (10 - sum % 10) % 10 == digits[11]
    }

    static func isValidDhlExpressWaybill(_ value: String) -> Bool {
        guard value.count == 10, matches(value, pattern: "^[0-9]{10}$"),
              let serial = Int(value.prefix(9)), let check = value.last?.wholeNumberValue else { return false }
        return serial % 7 == check
    }

    static func isValidTntConsignmentNumber(_ value: String) -> Bool {
        guard value.count == 9, matches(value, pattern: "^[0-9]{9}$"),
              let serial = Int(value.prefix(8)), let check = value.last?.wholeNumberValue else { return false }
        if serial % 7 == check { return true }
        let digits = value.compactMap(\.wholeNumberValue)
        let weights = [8, 6, 4, 2, 3, 5, 9, 7]
        let sum = weights.enumerated().reduce(0) { $0 + digits[$1.offset] * $1.element }
        let digit = 11 - sum % 11
        return (digit == 11 ? 5 : digit == 10 ? 0 : digit) == check
    }

    static func isValidPocztaPolskaBarcode(_ value: String) -> Bool {
        guard value.count == 20, matches(value, pattern: "^[0-9]{20}$") else { return false }
        let digits = value.compactMap(\.wholeNumberValue)
        let sum = digits[0..<19].enumerated().reduce(0) { $0 + $1.element * ($1.offset % 2 == 0 ? 3 : 1) }
        return (10 - sum % 10) % 10 == digits[19]
    }

    /// Correos parcel and expedition codes: the summed character codes before the last letter pick it from the tax-id letter table.
    static func isValidCorreosSpainCheckLetter(_ value: String) -> Bool {
        let letters = Array("TRWAGMYFPDXBNJZSQVHLCKE")
        guard value.count > 1, let last = value.last else { return false }
        let sum = value.dropLast().unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return letters[sum % letters.count] == last
    }

    /// DPD parcel labels: fourteen digits and the ISO/IEC 7064 MOD 37,36 check character printed after them.
    static func isValidDpdParcelNumber(_ value: String) -> Bool {
        guard value.count == 15, matches(value, pattern: "^[0-9]{14}[0-9A-Z]$") else { return false }
        let alphabet = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        var remainder = 36
        for digit in value.prefix(14).compactMap(\.wholeNumberValue) {
            remainder += digit
            if remainder > 36 { remainder -= 36 }
            remainder *= 2
            if remainder > 36 { remainder -= 37 }
        }
        return alphabet[(37 - remainder) % 36] == value.last
    }

    static func isValidS10(_ raw: String) -> Bool {
        let value = normalize(raw)
        guard matches(value, pattern: "^[A-Z]{2}\\d{9}[A-Z]{2}$") else { return false }
        let characters = Array(value)
        let weights = [8, 6, 4, 2, 3, 5, 9, 7]
        let sum = weights.enumerated().reduce(0) { partial, item in
            partial + (characters[item.offset + 2].wholeNumberValue ?? 0) * item.element
        }
        let rawCheck = 11 - sum % 11
        let expected = rawCheck == 10 ? 0 : (rawCheck == 11 ? 5 : rawCheck)
        return characters[10].wholeNumberValue == expected
    }

    static func supportsSwissPostHandoff(_ raw: String) -> Bool {
        let value = normalize(raw)
        return matches(value, pattern: "^L[A-Z]\\d{9}CH$") && isValidS10(value)
    }

    /// A number introduced by a "tracking number:" style label, as the web engine reads it.
    /// "No" and "ID" also start numbers, so they belong to the label only when they stand
    /// apart from what follows. The token holds a digit, so a label followed by a plain
    /// word does not end the search.
    private static let labelledNumberPattern: String = {
        let suffix = "(?:numbers?(?![A-Z])|no\\.|(?:no|id)(?![A-Z0-9.]))"
        return "(?:track(?:ing)?(?:\\s*\(suffix)|(?![A-Z]))"
            + "|(?:parcel|shipment)(?:\\s+(?:tracking(?![A-Z])|\(suffix))|(?![A-Z])))"
            + "(?:\\s+is(?![A-Z0-9]))?\\s*[:#-]?\\s*"
            + "((?=[A-Z0-9.-]{0,39}\\d)[A-Z0-9][A-Z0-9.-]{3,39})"
    }()

    private static func shaped(_ value: String) -> Bool {
        (4...40).contains(value.count)
            && (matches(value, pattern: "^[A-Z0-9]+$") || matches(value, pattern: "^\\d{4}/\\d{8}$"))
    }

    /// A number entered whole or carried by a carrier's link. Without a digit it must be
    /// six to ten unbroken letters that a carrier's detection rule claims, as GLS issues
    /// six-letter Track IDs: a word no carrier uses is not a number.
    private func valid(_ raw: String) -> Bool {
        let value = Self.normalize(raw)
        guard Self.shaped(value) else { return false }
        if Self.matches(value, pattern: "\\d") { return true }
        return Self.matches(raw.trimmingCharacters(in: .whitespacesAndNewlines), pattern: "^[A-Za-z]{6,10}$")
            && detect(value).confidence != .none
    }

    /// A number pulled out of prose always holds a digit: a word there is not a number.
    private static func validInText(_ raw: String) -> Bool {
        let value = normalize(raw)
        return shaped(value) && matches(value, pattern: "\\d")
    }

    /// Compiling a pattern costs far more than matching it, and detection runs
    /// every carrier rule for each keystroke and card.
    private static func expression(_ pattern: String, caseInsensitive: Bool = false) -> NSRegularExpression? {
        let key = ((caseInsensitive ? "i:" : "s:") + pattern) as NSString
        if let cached = expressions.object(forKey: key) { return cached }
        let options: NSRegularExpression.Options = caseInsensitive ? .caseInsensitive : []
        guard let compiled = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
        expressions.setObject(compiled, forKey: key)
        return compiled
    }

    private static func matches(_ value: String, pattern: String) -> Bool {
        guard let expression = expression(pattern) else { return false }
        return expression.firstMatch(
            in: value,
            range: NSRange(value.startIndex..., in: value)
        ) != nil
    }

    private static func matches(
        in value: String,
        pattern: String,
        caseInsensitive: Bool = false
    ) -> [String] {
        guard let expression = expression(pattern, caseInsensitive: caseInsensitive) else { return [] }
        return expression.matches(in: value, range: NSRange(value.startIndex..., in: value)).compactMap {
            Range($0.range, in: value).map { String(value[$0]) }
        }
    }

    private static func capture(
        _ value: String,
        pattern: String,
        caseInsensitive: Bool = false
    ) -> String? {
        guard let expression = expression(pattern, caseInsensitive: caseInsensitive),
              let match = expression.firstMatch(
                in: value,
                range: NSRange(value.startIndex..., in: value)
              ),
              match.numberOfRanges > 1,
              let range = Range(match.range(at: 1), in: value) else { return nil }
        return String(value[range])
    }

    private static func urlEncode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
    }

    private static func renderTrackingURL(
        _ template: String?,
        carrier: CarrierID,
        trackingNumber: String
    ) -> String? {
        if carrier == .amazonLogistics { return amazonOrdersURL(trackingNumber).absoluteString }
        if carrier == .amazonShipping { return amazonShippingURL(trackingNumber).absoluteString }
        guard let template else { return nil }
        let normalized = normalize(trackingNumber)
        var linkNumber = trackingNumber
        if carrier == .mondialRelay, isValidMondialRelayBarcode(normalized) { linkNumber = String(normalized.prefix(12)) }
        if carrier == .cChezVous,
           normalized.range(of: "^[A-Z0-9]{11}[0-9]{5}$", options: .regularExpression) != nil {
            let split = normalized.index(normalized.startIndex, offsetBy: 11)
            linkNumber = "\(normalized[..<split])--\(normalized[split...])"
        }
        if carrier == .theCourierGuy,
           normalized.range(of: "^(DD|LD)[A-Z0-9]{6}$", options: .regularExpression) != nil {
            let split = normalized.index(normalized.startIndex, offsetBy: 2)
            linkNumber = "\(normalized[..<split])-\(normalized[split...])"
        }
        if carrier == .postlogistics { linkNumber = format(trackingNumber, carrier: carrier) }
        return template.replacingOccurrences(
            of: "{trackingNumber}",
            with: urlEncode(linkNumber)
        )
    }

    private static func bundledDefinitions(in bundle: Bundle) -> [CarrierID: CarrierDefinition] {
        guard let url = bundle.url(forResource: "CarrierCatalog", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let contract = try? JSONDecoder().decode(Contract.self, from: data),
              let definitions = try? validatedDefinitions(contract) else {
            return fallbackDefinitions
        }
        return definitions
    }

    private static func cachedContract(
        at url: URL
    ) -> (definitions: [CarrierID: CarrierDefinition], etag: String?)? {
        guard let data = try? Data(contentsOf: url),
              let record = try? JSONDecoder().decode(CacheRecord.self, from: data),
              let definitions = try? validatedDefinitions(record.contract) else { return nil }
        return (definitions, record.etag)
    }

    private static func validatedDefinitions(
        _ contract: Contract
    ) throws -> [CarrierID: CarrierDefinition] {
        let validEntries = contract.carriers.filter { key, _ in
            matches(key, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$") && key.count <= 64
        }
        let definitions = Dictionary(uniqueKeysWithValues: validEntries.map { key, value in
            (CarrierID(rawValue: key), value)
        })
        guard definitions[.unknown] != nil,
              definitions.values.contains(where: \.selectable) else {
            throw CatalogError.invalidContract
        }
        return definitions
    }

    private func saveCache(contract: Contract, etag: String?) {
        guard let cacheURL,
              let data = try? JSONEncoder().encode(CacheRecord(etag: etag, contract: contract)) else {
            return
        }
        let directory = cacheURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        try? data.write(to: cacheURL, options: .atomic)
    }

    /// The cache is re-encoded from the decoded structs, so a file written by a build
    /// that did not know a catalog field has lost it. Bump the name when one is added.
    private static func defaultCacheURL() -> URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appending(path: "delivery-tracker", directoryHint: .isDirectory)
            .appending(path: "carrier-catalog-v4.json")
    }

    private static let emptyMatch = TrackingInputMatch(
        trackingNumber: "",
        carrier: .unknown,
        confidence: .none,
        candidates: [],
        trackingURL: nil,
        source: .none
    )

    private static let fallbackDefinitions: [CarrierID: CarrierDefinition] = [
        .unknown: CarrierDefinition(
            displayName: "Unknown carrier",
            displayNames: ["en": "Unknown carrier", "de": "Paketdienst unbekannt",
                           "fr": "Transporteur inconnu", "it": "Corriere sconosciuto"],
            trackingSiteName: nil,
            color: CarrierVisualIdentity.defaultCarrierColor,
            selectable: false,
            timezone: "UTC",
            tracking: .init(mode: "link-only", adapter: nil, requirements: nil),
            trackingURLTemplate: nil,
            linkRules: [],
            detectionRules: []
        ),
    ]
}
