import Foundation
import CryptoKit

/// The web addresses whose links open in the app: the site itself, and the hosts it answered on
/// before, so links shared from there keep working. Those hosts are only ever read from an
/// incoming link. The app calls the API and builds the links it shares on the site's own host.
enum SiteLink {
    static func belongs(
        _ url: URL,
        baseURL: URL = AppConfiguration.current.apiBaseURL,
        linkHosts: [String] = AppConfiguration.current.linkHosts
    ) -> Bool {
        guard url.user == nil, url.password == nil, let host = url.host?.lowercased() else { return false }
        if url.scheme == baseURL.scheme, host == baseURL.host?.lowercased(), url.port == baseURL.port { return true }
        return url.scheme == "https" && url.port == nil && linkHosts.contains(host)
    }
}

/// A tapped web link can reach the app twice, as a URL to open and as a browsing activity to
/// continue. It opens once.
struct LinkDeliveries {
    private var last: (url: URL, at: Date)?

    mutating func isRepeat(_ url: URL, now: Date = .now) -> Bool {
        defer { last = (url, now) }
        guard let last else { return false }
        return last.url == url && now.timeIntervalSince(last.at) >= 0 && now.timeIntervalSince(last.at) < 1
    }
}

enum FriendInvitationLink {
    static func isInvitation(
        _ url: URL,
        baseURL: URL = AppConfiguration.current.apiBaseURL,
        linkHosts: [String] = AppConfiguration.current.linkHosts
    ) -> Bool {
        guard url.user == nil, url.password == nil else { return false }
        if url.scheme?.lowercased() == OAuthFlow.callbackScheme { return url.host?.lowercased() == "invite" && url.path.isEmpty }
        return SiteLink.belongs(url, baseURL: baseURL, linkHosts: linkHosts) && (url.path == "/invite" || url.path.hasPrefix("/i/"))
    }

    static func code(
        from text: String,
        baseURL: URL = AppConfiguration.current.apiBaseURL,
        linkHosts: [String] = AppConfiguration.current.linkHosts
    ) -> String? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              isInvitation(url, baseURL: baseURL, linkHosts: linkHosts) else { return nil }
        if url.path.hasPrefix("/i/") {
            let key = String(url.path.dropFirst(3))
            return validPreviewID(key) ? key : nil
        }
        guard let code = url.fragment, validCode(code) else { return nil }
        if url.query != nil {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard items.count == 1, items[0].name == "preview", items[0].value == previewHash(code) else { return nil }
        }
        return code
    }

    static func validCode(_ value: String) -> Bool {
        validPreviewID(value) || value.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil
    }

    private static func validPreviewID(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{16}$", options: .regularExpression) != nil
    }

    private static func previewHash(_ code: String) -> String {
        SHA256.hash(data: Data(code.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func url(code: String, previewId: String? = nil, baseURL: URL = AppConfiguration.current.apiBaseURL) -> URL {
        if let previewId, validPreviewID(previewId) {
            var components = URLComponents(url: baseURL.appending(path: "i").appending(path: previewId), resolvingAgainstBaseURL: false)!
            components.query = nil
            components.fragment = nil
            return components.url!
        }
        // Compatibility with servers that have not started returning short IDs.
        var components = URLComponents(url: baseURL.appending(path: "invite"), resolvingAgainstBaseURL: false)!
        // Fragments never travel in HTTP requests or Referer headers.
        components.queryItems = [URLQueryItem(name: "preview", value: previewHash(code))]
        components.fragment = code
        return components.url!
    }
}

/// A link's public name and gift message. Older links carry them in the fragment;
/// new gift links read the message from the service after delivery.
struct ParcelLinkWords: Equatable, Sendable {
    var name: String? = nil
    var note: String? = nil
    var from: String? = nil

    /// The longest note and signature a link carries, in Unicode scalars as the site counts them.
    static let noteLimit = 280
    static let fromLimit = 60
    /// A parcel's name holds 80 UTF-16 units, the length its account accepts.
    static let nameLimit = 80

    init(name: String? = nil, note: String? = nil, from: String? = nil) {
        self.name = name
        self.note = note
        self.from = from
    }

    /// Reads `n=<name>&g=<note>&f=<from>`, each percent-encoded and cleaned to what it may hold.
    init(fragment: String?) {
        let parts = fragment?.split(separator: "&") ?? []
        func value(_ key: String) -> String? {
            parts.first { $0.hasPrefix(key + "=") }.flatMap { String($0.dropFirst(key.count + 1)).removingPercentEncoding }
        }
        name = value("n").flatMap(Self.cleanName)
        note = value("g").flatMap { Self.clean($0, limit: Self.noteLimit) }
        from = value("f").flatMap { Self.clean($0, limit: Self.fromLimit) }
    }

    /// The same words as the `#` part of an address, encoded as the site encodes them. Nil when there are none.
    var fragment: String? {
        let parts = [("n", name.flatMap(Self.cleanName)),
                     ("g", note.flatMap { Self.clean($0, limit: Self.noteLimit) }),
                     ("f", from.flatMap { Self.clean($0, limit: Self.fromLimit) })]
            .compactMap { key, value in
                value.flatMap { $0.addingPercentEncoding(withAllowedCharacters: Self.unescaped) }.map { "\(key)=\($0)" }
            }
        return parts.isEmpty ? nil : parts.joined(separator: "&")
    }

    static func cleanName(_ value: String) -> String? {
        clean(value, limit: nameLimit) { $0.utf16.count }
    }

    /// One line without control characters, at most `limit` long. Whole characters only, so a
    /// cut never leaves half an emoji.
    static func clean(_ value: String, limit: Int, length: (Character) -> Int = { $0.unicodeScalars.count }) -> String? {
        var line = String.UnicodeScalarView()
        var gap = false
        for scalar in value.unicodeScalars {
            let category = scalar.properties.generalCategory
            if scalar.properties.isWhitespace || category == .control || category == .format {
                gap = !line.isEmpty
            } else {
                if gap { line.append(" ") }
                gap = false
                line.append(scalar)
            }
        }
        var text = ""
        var used = 0
        for character in String(line) {
            used += length(character)
            guard used <= limit else { break }
            text.append(character)
        }
        return text.trimmingCharacters(in: .whitespaces).nonEmpty
    }

    /// What JavaScript's `encodeURIComponent` leaves as it is.
    private static let unescaped = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
}

/// A parcel link, `/p/<id>`. The id is the capability. A name someone gave the parcel, and a
/// gift's note and signature, can be read from older fragments or from the service after delivery.
struct ParcelLinkRoute: Equatable, Sendable {
    let id: String
    var name: String? = nil
    /// A gift's note and who it is from. Shown only once the parcel is delivered.
    var note: String? = nil
    var from: String? = nil

    private static let alphabet = Array("23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
    private static let symbols = Set(alphabet)

    static func validID(_ value: String) -> Bool {
        value.count == 12 && value.allSatisfy(symbols.contains)
    }

    /// An id in the format the service gives a link, for a demo that has no service.
    static func madeUpID(using generator: inout some RandomNumberGenerator) -> String {
        String((0..<12).map { _ in alphabet.randomElement(using: &generator)! })
    }

    init(id: String, name: String? = nil, note: String? = nil, from: String? = nil) {
        self.id = id
        self.name = name
        self.note = note
        self.from = from
    }

    /// The link's address on the site, with an optional public name. Gift messages never go in URLs.
    static func address(
        id: String,
        words: ParcelLinkWords = ParcelLinkWords(),
        baseURL: URL = AppConfiguration.current.apiBaseURL
    ) -> URL {
        var components = URLComponents(url: baseURL.appending(path: "p").appending(path: id), resolvingAgainstBaseURL: false)!
        components.query = nil
        components.percentEncodedFragment = ParcelLinkWords(name: words.name).fragment
        return components.url!
    }

    init?(
        url: URL,
        baseURL: URL = AppConfiguration.current.apiBaseURL,
        linkHosts: [String] = AppConfiguration.current.linkHosts
    ) {
        guard url.user == nil, url.password == nil else { return nil }
        let id: String
        if url.scheme?.lowercased() == OAuthFlow.callbackScheme {
            guard url.host?.lowercased() == "p", url.path.hasPrefix("/") else { return nil }
            id = String(url.path.dropFirst())
        } else {
            guard SiteLink.belongs(url, baseURL: baseURL, linkHosts: linkHosts), url.path.hasPrefix("/p/") else { return nil }
            id = String(url.path.dropFirst(3))
        }
        guard Self.validID(id) else { return nil }
        self.id = id
        let words = ParcelLinkWords(fragment: URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedFragment)
        name = words.name
        note = words.note
        from = words.from
    }

    /// `n=<percent-encoded name>`, cleaned to what a parcel's name may hold.
    static func name(inFragment fragment: String?) -> String? {
        ParcelLinkWords(fragment: fragment).name
    }
}

enum NativeRoute: Equatable {
    case parcel(UUID)
    case friend(UUID)
    case add(trackingInput: String)

    init?(url: URL) {
        guard url.scheme?.lowercased() == OAuthFlow.callbackScheme else { return nil }
        switch url.host?.lowercased() {
        case "friend":
            guard let raw = url.pathComponents.last, let friendID = UUID(uuidString: raw) else { return nil }
            self = .friend(friendID)
        case "parcel":
            guard let raw = url.pathComponents.last,
                  let parcelID = UUID(uuidString: raw) else { return nil }
            self = .parcel(parcelID)
        case "add":
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let tracking = components?.queryItems?.first(where: { $0.name == "tracking" })?.value ?? ""
            self = .add(trackingInput: tracking)
        default:
            return nil
        }
    }

    init?(remoteNotification payload: [AnyHashable: Any]) {
        if payload["kind"] as? String == "friend_accepted", let raw = payload["friend_id"] as? String,
           let friendID = UUID(uuidString: raw) { self = .friend(friendID); return }
        guard let raw = payload["parcel_id"] as? String,
              let parcelID = UUID(uuidString: raw) else { return nil }
        self = .parcel(parcelID)
    }
}

enum OAuthFlow {
    static let callbackScheme = "swissdeliverytracker"
    static let callbackHost = "auth-callback"

    static var callbackURL: URL {
        URL(string: "\(callbackScheme)://\(callbackHost)")!
    }

    static func authorizationURL(
        baseURL: URL,
        provider: String,
        codeChallenge: String
    ) -> URL? {
        guard var components = URLComponents(
            url: baseURL.appending(path: "auth/v1/authorize"),
            resolvingAgainstBaseURL: false
        ) else { return nil }
        components.queryItems = [
            URLQueryItem(name: "provider", value: provider),
            URLQueryItem(name: "redirect_to", value: callbackURL.absoluteString),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
        ]
        return components.url
    }

    static func authorizationCode(from callback: URL) -> String? {
        guard callback.scheme?.lowercased() == callbackScheme,
              callback.host?.lowercased() == callbackHost,
              let components = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
              !code.isEmpty else { return nil }
        return code
    }
}
