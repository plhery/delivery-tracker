import Foundation
import SwiftUI

struct AppConfiguration: Sendable {
    enum Mode: Sendable {
        case demo
        case api
    }

    let mode: Mode
    let apiBaseURL: URL
    let supabaseURL: URL?
    let supabasePublishableKey: String
    let googleAuthEnabled: Bool
    let appleAuthEnabled: Bool
    let emailOTPEnabled: Bool
    let appGroupIdentifier: String

    static let current: AppConfiguration = {
        let useAPI = value("SDTUseAPI").uppercased() == "YES"
        let baseURL = URL(string: value("SDTAPIBaseURL"))
            ?? URL(string: "https://delivery.plhery.com")!
        let supabase = URL(string: value("SDTSupabaseURL"))
        return AppConfiguration(
            mode: useAPI ? .api : .demo,
            apiBaseURL: baseURL,
            supabaseURL: supabase,
            supabasePublishableKey: value("SDTSupabasePublishableKey"),
            googleAuthEnabled: value("SDTGoogleAuthEnabled").uppercased() == "YES",
            appleAuthEnabled: value("SDTAppleAuthEnabled").uppercased() == "YES",
            emailOTPEnabled: value("SDTEmailOTPEnabled").uppercased() != "NO",
            appGroupIdentifier: value("SDTAppGroupIdentifier").nonEmpty
                ?? "group.com.plhery.SwissDeliveryTracker"
        )
    }()

    var authenticationConfigured: Bool {
        supabaseURL != nil && !supabasePublishableKey.isEmpty
    }

    var privacyURL: URL {
        apiBaseURL.appending(path: "privacy.html")
    }

    private static func value(_ key: String) -> String {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return "" }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.contains("$(") ? "" : trimmed
    }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

enum AppLanguage: String, CaseIterable, Identifiable, Codable, Hashable {
    case en, de, fr, it, es, pt, pl

    var id: String { rawValue }
    var locale: Locale { Locale(identifier: self == .pt ? "pt-PT" : rawValue) }
    var nativeName: String {
        switch self {
        case .en: "English"
        case .de: "Deutsch"
        case .fr: "Français"
        case .it: "Italiano"
        case .es: "Español"
        case .pt: "Português"
        case .pl: "Polski"
        }
    }
}

@MainActor
final class Localizer: ObservableObject {
    @Published var language: AppLanguage {
        didSet {
            UserDefaults.standard.set(language.rawValue, forKey: Self.storageKey)
            saveSharedLanguage()
        }
    }

    private static let storageKey = "deliveryTrackerLocale"
    private let dictionaries: [String: [String: String]]

    init(bundle: Bundle = .main) {
        let saved = UserDefaults.standard.string(forKey: Self.storageKey)
        let preferred = Locale.preferredLanguages.compactMap {
            AppLanguage(rawValue: $0.split(separator: "-").first.map(String.init)?.lowercased() ?? "")
        }.first
        language = AppLanguage(rawValue: saved ?? "")
            ?? preferred
            ?? .en
        if let url = bundle.url(forResource: "Localization", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode([String: [String: String]].self, from: data) {
            dictionaries = decoded
        } else {
            dictionaries = ["en": [:]]
        }
        saveSharedLanguage()
    }

    private func saveSharedLanguage() {
        UserDefaults(suiteName: AppConfiguration.current.appGroupIdentifier)?
            .set(language.rawValue, forKey: Self.storageKey)
    }

    func text(_ key: String, _ variables: [String: CustomStringConvertible] = [:]) -> String {
        let messages = dictionaries[language.rawValue] ?? dictionaries["en"] ?? [:]
        let count = variables["count"].flatMap { Double($0.description) }
        let category: String
        if count == 1 {
            category = "one"
        } else if language == .pl, let count, count.isFinite, count >= 0,
                  count.rounded(.towardZero) == count {
            // Polish integer counts: 2–4, except 12–14, use the few form.
            let last = count.truncatingRemainder(dividingBy: 10)
            let lastTwo = count.truncatingRemainder(dividingBy: 100)
            category = (2...4).contains(last) && !(12...14).contains(lastTwo) ? "few" : "many"
        } else {
            category = "other"
        }
        let baseKey = key.replacingOccurrences(of: "\\.(one|few|many)$", with: "", options: .regularExpression)
        let pluralKey = "\(baseKey).\(category)"
        let selectedKey = category != "other" && messages[pluralKey] != nil ? pluralKey : key
        var result = messages[selectedKey]
            ?? dictionaries["en"]?[selectedKey]
            ?? key
        for (name, value) in variables {
            result = result.replacingOccurrences(of: "{{\(name)}}", with: value.description)
        }
        return result
    }

    func errorMessage(_ error: Error) -> String {
        if let error = error as? DeliveryAPIError {
            switch error {
            case .authenticationExpired:
                return text("native.error.authenticationExpired")
            case .duplicateTracking:
                return text("native.error.duplicateTracking")
            case .invalidResponse:
                return text("native.error.invalidResponse")
            case .labelTooLong:
                return text("native.error.labelTooLong")
            case .notificationsDenied:
                return text("native.notificationsDenied")
            case .parcelMissing:
                return text("native.parcelMissing")
            case .pushTokenUnavailable:
                return text("native.apnsTokenError")
            case .refreshFailed:
                return text("native.error.refreshFailed")
            case .refreshTimeout:
                return text("native.error.refreshTimeout")
            case .rateLimited:
                return text("native.error.rateLimited")
            case .service(let message):
                return serviceErrorMessage(message)
            case .serviceFailed(let status):
                return text("native.error.serviceFailed", ["status": status])
            }
        }
        if let error = error as? AuthenticationError {
            switch error {
            case .notConfigured:
                return text("native.auth.notConfigured")
            case .invalidResponse:
                return text("native.auth.invalidResponse")
            case .missingSession:
                return text("native.auth.missingSession")
            case .oauthCancelled:
                return text("native.auth.cancelled")
            case .requestFailed(let status):
                return text("native.auth.requestFailed", ["status": status])
            case .secureRequestFailed:
                return text("native.auth.secureRequest")
            case .sessionSaveFailed:
                return text("native.auth.saveSession")
            case .server(let message):
                return serviceErrorMessage(message, fallback: "auth.verifyFailed")
            }
        }
        if error is URLError { return text("error.connection") }
        return text("error.generic")
    }

    private func serviceErrorMessage(_ message: String, fallback: String = "error.generic") -> String {
        let value = message.lowercased()
        let rules: [(String, String)] = [
            ("rate.?limit|too many requests", "error.rateLimited"),
            ("otp_expired|invalid.*(code|token)|(code|token).*expired", "error.invalidCode"),
            ("email.*(invalid|valid)|invalid.*email", "error.invalidEmail"),
            ("amazon france.*amazon account", "add.amazonAccount"),
            ("postcode|postal code", "error.postcode"),
            ("tracking.*(url|link)|complete.*link", "error.trackingLink"),
            ("tracking (number|input)|parcel number", "error.trackingNumber"),
            ("80 characters|label.*long", "error.nameTooLong"),
            ("package not found|parcel.*no longer", "native.parcelMissing"),
        ]
        for (pattern, key) in rules where value.range(of: pattern, options: .regularExpression) != nil {
            return text(key)
        }
        return text(fallback)
    }

    func eventDescription(_ description: String) -> String {
        let keys = [
            "Tracking added": "event.added",
            "Tracking added; the carrier has not announced it yet": "event.waiting",
            "Carrier changed; waiting for tracking": "event.carrierChanged",
        ]
        return keys[description].map { text($0) } ?? description
    }

    func relativeTime(from value: String, now: Date = Date()) -> String {
        guard let date = DateParser.date(value) else { return "" }
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 { return text("time.justNow") }
        if seconds < 3_600 {
            return text("time.minutesAgo", ["count": max(1, Int(seconds / 60))])
        }
        if seconds < 86_400 {
            return text("time.hoursAgo", ["count": max(1, Int(seconds / 3_600))])
        }
        if seconds < 604_800 {
            return text("time.daysAgo", ["count": max(1, Int(seconds / 86_400))])
        }
        return shortDate(date)
    }

    func expectedDelivery(_ value: String, now: Date = Date()) -> String {
        let expression = try? NSRegularExpression(
            pattern: "^(\\d{4}-\\d{2}-\\d{2})[ T]+(\\d{2}:\\d{2})(?:[–-](\\d{2}:\\d{2}))?$"
        )
        let range = NSRange(value.startIndex..., in: value)
        if let match = expression?.firstMatch(in: value, range: range),
           let dayRange = Range(match.range(at: 1), in: value),
           let timeRange = Range(match.range(at: 2), in: value) {
            let day = expectedDelivery(String(value[dayRange]), now: now)
            var window = String(value[timeRange])
            if match.range(at: 3).location != NSNotFound,
               let endRange = Range(match.range(at: 3), in: value) {
                window += "–\(value[endRange])"
            }
            return "\(day), \(window)"
        }

        guard let date = DateParser.deliveryDate(value) else { return value }
        if value.contains("T"), let timestamp = DateParser.date(value) {
            let formatter = DateFormatter()
            formatter.locale = language.locale
            formatter.dateFormat = "HH:mm"
            let dayFormatter = DateFormatter()
            dayFormatter.calendar = Calendar(identifier: .gregorian)
            dayFormatter.locale = Locale(identifier: "en_US_POSIX")
            dayFormatter.dateFormat = "yyyy-MM-dd"
            return "\(expectedDelivery(dayFormatter.string(from: timestamp), now: now)), \(formatter.string(from: timestamp))"
        }
        return deliveryDate(date, now: now)
    }

    func deliveryDate(_ date: Date, now: Date = Date()) -> String {
        let calendar = Calendar.current
        if calendar.isDate(date, inSameDayAs: now) { return text("time.today") }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(date, inSameDayAs: yesterday) {
            return text("time.yesterday")
        }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now),
           calendar.isDate(date, inSameDayAs: tomorrow) {
            return text("time.tomorrow")
        }
        return shortDate(date)
    }

    func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "EEE"
        let weekday = formatter.string(from: date).replacingOccurrences(of: ".", with: "")
        formatter.dateFormat = "d"
        let day = formatter.string(from: date)
        formatter.dateFormat = "MMM"
        let month = formatter.string(from: date).replacingOccurrences(of: ".", with: "").lowercased(with: language.locale)
        return "\(weekday.prefix(1).uppercased(with: language.locale))\(weekday.dropFirst()) \(day) \(month)"
    }

    func dateTime(_ value: String) -> String {
        guard let date = DateParser.date(value) else { return value }
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.dateFormat = "HH:mm"
        return "\(shortDate(date)), \(formatter.string(from: date))"
    }

    func parcelStatus(_ parcel: Parcel) -> String {
        text(parcel.displayStatus.key)
    }

    func parcelDeliveryEstimate(_ parcel: Parcel, now: Date = Date()) -> String? {
        guard let value = parcel.expectedDelivery,
              parcel.currentStage?.isFinal != true,
              parcel.currentStage != .readyForPickup, parcel.currentStage != .failedAttempt,
              let date = DateParser.deliveryDate(value) else { return nil }
        let calendar = Calendar.current
        guard calendar.startOfDay(for: date) >= calendar.startOfDay(for: now) else { return nil }
        return expectedDelivery(value, now: now)
    }

    func parcelCompletionDate(_ parcel: Parcel, now: Date = Date()) -> String? {
        if let event = parcel.currentEvent,
           event.stage.isFinal,
           let date = DateParser.date(event.occurredAt) {
            return deliveryDate(date, now: now)
        }
        return nil
    }
}

extension Parcel {
    var trackingSource: CarrierID? { carrierData?.activeTrackingCarrier }
    var swissPostReady: Bool { carrierData?.swissPostReady == true }
}

enum DateParser {
    private static let internetWithFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let internet: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
    private static let parsedDates: NSCache<NSString, NSDate> = {
        let cache = NSCache<NSString, NSDate>()
        cache.countLimit = 4_096
        return cache
    }()
    private static let parserLock = NSLock()

    static func date(_ value: String) -> Date? {
        // Rendering asks for the same event timestamps repeatedly. Reconfiguring
        // a formatter here discards its internal state on every comparison.
        let key = value as NSString
        if let cached = parsedDates.object(forKey: key) { return cached as Date }
        return parserLock.withLock {
            guard let date = internetWithFraction.date(from: value) ?? internet.date(from: value) else { return nil }
            parsedDates.setObject(date as NSDate, forKey: key)
            return date
        }
    }

    static func deliveryDate(_ value: String) -> Date? {
        if let timestamp = date(value) { return timestamp }
        let day = String(value.prefix(10))
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: day)
    }

    static func isoString(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }
}

extension JSONDecoder {
    static var deliveryTracker: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

extension JSONEncoder {
    static var deliveryTracker: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}
