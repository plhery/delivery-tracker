import Foundation

/// Gift words are kept by the service until delivery; public names can travel after `#`.
struct ParcelShareWords: Codable, Equatable, Sendable {
    /// The link carries the parcel's name.
    var name = false
    /// A gift's note, and who it is from, as typed.
    var note = ""
    var from = ""

    /// The words as a link may carry them: one line each, within their limits.
    var cleaned: ParcelShareWords {
        ParcelShareWords(name: name, note: ParcelLinkWords.clean(note, limit: ParcelLinkWords.noteLimit) ?? "",
                         from: ParcelLinkWords.clean(from, limit: ParcelLinkWords.fromLimit) ?? "")
    }

    /// What is being typed, kept within what a link may carry. Spaces stay until the words are cleaned.
    var limited: ParcelShareWords {
        ParcelShareWords(name: name, note: Self.limit(note, to: ParcelLinkWords.noteLimit), from: Self.limit(from, to: ParcelLinkWords.fromLimit))
    }

    private static func limit(_ text: String, to limit: Int) -> String {
        guard text.unicodeScalars.count > limit else { return text }
        var kept = ""
        var used = 0
        for character in text {
            used += character.unicodeScalars.count
            guard used <= limit else { break }
            kept.append(character)
        }
        return kept
    }
}

/// The words this device keeps for the links it shares, one entry per parcel. They are dropped
/// when sharing stops, when the parcel is deleted and when the account leaves this device.
struct ParcelShareNotes {
    private static let key = "sdt.parcelShareWords.v1"
    /// Only the latest links can still matter.
    private static let limit = 60

    private struct Entry: Codable {
        var words: ParcelShareWords
        var savedAt: Date
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func words(for parcelID: UUID) -> ParcelShareWords? {
        read()[parcelID.uuidString]?.words
    }

    /// Words that say nothing are not kept.
    func remember(_ words: ParcelShareWords, for parcelID: UUID, now: Date = Date()) {
        var entries = read()
        let cleaned = words.cleaned
        entries[parcelID.uuidString] = cleaned == ParcelShareWords() ? nil : Entry(words: cleaned, savedAt: now)
        write(entries)
    }

    func forget(_ parcelID: UUID) {
        var entries = read()
        guard entries.removeValue(forKey: parcelID.uuidString) != nil else { return }
        write(entries)
    }

    func forgetAll() {
        defaults.removeObject(forKey: Self.key)
    }

    private func read() -> [String: Entry] {
        defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode([String: Entry].self, from: $0) } ?? [:]
    }

    private func write(_ entries: [String: Entry]) {
        guard !entries.isEmpty else { forgetAll(); return }
        let kept = entries.sorted { $0.value.savedAt > $1.value.savedAt }.prefix(Self.limit)
        defaults.set(try? JSONEncoder().encode(Dictionary(uniqueKeysWithValues: kept.map { ($0.key, $0.value) })), forKey: Self.key)
    }
}

/// The demo's own links: made up on this device, and leading nowhere.
struct DemoParcelShares {
    private static let key = "sdt.native.demo.shares.v1"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func link(for parcelID: UUID) -> ParcelShare? {
        read()[parcelID.uuidString]
    }

    /// Makes the parcel's link when it has none, else changes what the link shows.
    func share(_ parcelID: UUID, showNumber: Bool, gift: Bool, giftWords: GiftWords? = nil, now: Date = Date()) -> ParcelShare {
        var links = read()
        var generator = SystemRandomNumberGenerator()
        var link = links[parcelID.uuidString]
            ?? ParcelShare(id: ParcelLinkRoute.madeUpID(using: &generator), showNumber: showNumber, gift: gift, createdAt: DateParser.isoString(now))
        link.showNumber = showNumber
        link.gift = gift
        if let giftWords { link.giftWords = giftWords }
        links[parcelID.uuidString] = link
        write(links)
        return link
    }

    func stop(_ parcelID: UUID) {
        var links = read()
        guard links.removeValue(forKey: parcelID.uuidString) != nil else { return }
        write(links)
    }

    func reset() {
        defaults.removeObject(forKey: Self.key)
    }

    private func read() -> [String: ParcelShare] {
        defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode([String: ParcelShare].self, from: $0) } ?? [:]
    }

    private func write(_ links: [String: ParcelShare]) {
        if links.isEmpty { reset() } else { defaults.set(try? JSONEncoder().encode(links), forKey: Self.key) }
    }
}

/// Sharing one of the account's parcels: its link, what the link shows, and the way to stop.
/// The link is made when the person shares or copies it, not when the sheet opens: until then
/// nothing about the parcel can be reached from outside the account.
@MainActor
final class ParcelShareModel: ObservableObject {
    /// What the service keeps for a link.
    struct Settings: Equatable, Sendable {
        var showNumber = false
        var gift = false
        var giftWords: GiftWords? = nil
    }

    enum Field: Hashable, Sendable { case showNumber, gift }

    /// How the sheet reaches the parcel's link: through the service, or in the demo.
    struct Client {
        /// The parcel's live link, or nil while it is not shared.
        var current: @MainActor () async throws -> ParcelShare?
        /// Makes the link when there is none, else changes it.
        var share: @MainActor (Settings) async throws -> ParcelShare
        /// The link goes blank for good; sharing again makes a new one.
        var stop: @MainActor () async throws -> Void
    }

    let parcelID: UUID
    /// The parcel's name, which the link carries when its sharer says so.
    let name: String?

    @Published private(set) var link: ParcelShare?
    /// The link's state is being read.
    @Published private(set) var loading = true
    /// Sharing was stopped from this sheet.
    @Published private(set) var stopped = false
    /// Sharing, copying or stopping is under way.
    @Published private(set) var working = false
    /// The message for what went wrong last, as a localization key.
    @Published private(set) var failureKey: String?
    @Published private var settings = Settings()
    /// Switches on their way to the service: shown at once, and put back if the service refuses.
    @Published private var saving: [Field: Bool] = [:]
    /// The public name and gift message, as typed.
    @Published var words = ParcelShareWords() {
        didSet {
            let limited = words.limited
            if limited != words { words = limited }
            remember()
        }
    }

    private let client: Client
    private let notes: ParcelShareNotes
    private let baseURL: URL
    /// What the device holds for this parcel's link, as far as this sheet knows.
    private var remembered: ParcelShareWords?

    init(parcelID: UUID, name: String?, client: Client, notes: ParcelShareNotes = ParcelShareNotes(),
         baseURL: URL = AppConfiguration.current.apiBaseURL) {
        self.parcelID = parcelID
        self.name = name.flatMap(ParcelLinkWords.cleanName)
        self.client = client
        self.notes = notes
        self.baseURL = baseURL
    }

    /// The switches as the sheet shows them.
    var shown: Settings {
        Settings(showNumber: saving[.showNumber] ?? settings.showNumber, gift: saving[.gift] ?? settings.gift)
    }

    func isSaving(_ field: Field) -> Bool { saving[field] != nil }

    /// What the link carries: the name when it is shared, and a gift's note and signature.
    var carried: ParcelLinkWords {
        let gift = shown.gift
        return ParcelLinkWords(name: words.name ? name : nil, note: gift ? words.note : nil, from: gift ? words.from : nil)
    }

    var savingChanges: Bool { !saving.isEmpty }

    /// The address to hand out, once there is a link.
    var address: URL? {
        link.map { ParcelLinkRoute.address(id: $0.id, words: shown.gift ? ParcelLinkWords() : carried, baseURL: baseURL) }
    }

    /// Reads the parcel's link. Without an answer the sheet offers what it can: sharing makes or finds the link.
    func load() async {
        do {
            let current = try await client.current()
            guard !Task.isCancelled else { return }
            if let current { adopt(current) } else { notes.forget(parcelID) }
        } catch {
            guard !Task.isCancelled else { return }
            words = notes.words(for: parcelID) ?? words
        }
        loading = false
    }

    /// Flips a switch. With a link it is saved at once; without one it is what the next link will show.
    func set(_ field: Field, to value: Bool) async {
        failureKey = nil
        var next = shown
        switch field {
        case .showNumber: next.showNumber = value
        case .gift: next.gift = value
        }
        guard link != nil else { settings = next; return }
        saving[field] = value
        do {
            adopt(try await client.share(next))
        } catch {
            failureKey = Self.failureKey(error)
        }
        // A later flip of the same switch may be on its way.
        if saving[field] == value { saving[field] = nil }
    }

    /// The address to share or copy, with the link made now when there is none. Nil when that failed.
    func addressToHandOut() async -> URL? {
        guard !loading, !working, !savingChanges else { return nil }
        if !shown.gift, let address { failureKey = nil; return address }
        guard await create() else { return nil }
        return address
    }

    func stop() async {
        guard !working else { return }
        working = true
        failureKey = nil
        do {
            try await client.stop()
            // The words went out with the link: they go with it.
            notes.forget(parcelID)
            remembered = nil
            link = nil
            words = ParcelShareWords()
            stopped = true
        } catch {
            failureKey = Self.failureKey(error)
        }
        working = false
    }

    /// Sharing again makes a new link, showing what the switches say.
    func shareAgain() async {
        if await create() { stopped = false }
    }

    /// Copying or sharing itself failed.
    func handOutFailed() {
        failureKey = "link.shareFailed"
    }

    private func create() async -> Bool {
        guard !working else { return false }
        working = true
        failureKey = nil
        defer { working = false }
        do {
            var request = shown
            if request.gift {
                let clean = carried
                request.giftWords = GiftWords(name: clean.name,
                    note: ParcelLinkWords.clean(clean.note ?? "", limit: ParcelLinkWords.noteLimit),
                    from: ParcelLinkWords.clean(clean.from ?? "", limit: ParcelLinkWords.fromLimit))
            }
            adopt(try await client.share(request))
            return true
        } catch {
            failureKey = Self.failureKey(error)
            return false
        }
    }

    /// Takes the link as the service describes it.
    private func adopt(_ answer: ParcelShare) {
        let known = link?.id == answer.id
        link = answer
        settings = Settings(showNumber: answer.showNumber, gift: answer.gift)
        guard !known else { return }
        // A link found again carries what this device kept for it; a new one, what was typed for it.
        if words == ParcelShareWords(), let saved = answer.giftWords {
            words = ParcelShareWords(name: saved.name != nil, note: saved.note ?? "", from: saved.from ?? "")
        } else if words == ParcelShareWords(), let kept = notes.words(for: parcelID) {
            remembered = kept
            words = kept
        } else {
            remember()
        }
    }

    /// Keeps the words on this device once there is a link to carry them.
    private func remember() {
        guard link != nil else { return }
        let cleaned = words.cleaned
        guard cleaned != remembered else { return }
        remembered = cleaned
        notes.remember(cleaned, for: parcelID)
    }

    private static func failureKey(_ error: Error) -> String? {
        if error is CancellationError { return nil }
        if let error = error as? URLError { return error.code == .cancelled ? nil : "error.connection" }
        switch error as? DeliveryAPIError {
        case .rateLimited: return "error.rateLimited"
        case .authenticationExpired: return "native.error.authenticationExpired"
        default: return "share.failed"
        }
    }
}

extension GiftWords {
    private enum WordKeys: String, CodingKey { case name, note, from }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: WordKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(note, forKey: .note)
        try container.encode(from, forKey: .from)
    }
}
