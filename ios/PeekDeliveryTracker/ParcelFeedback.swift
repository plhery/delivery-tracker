import CryptoKit
import Foundation

/// What a parcel's page asks its reader. For a parcel a carrier answers for, Pip asks where the
/// history ends whether he got it right, and the page asks once more on the way back from the
/// carrier's own site. For a parcel no carrier was found for, a row asks whether the carrier's
/// site shows it.
enum ParcelFeedbackQuestion: Equatable, Sendable {
    case found
    case unknown

    /// Nil asks nothing: the parcel is archived, still waits for its first answer, or has a
    /// carrier whose history the page does not show.
    init?(parcel: Parcel, showsHistory: Bool) {
        guard !parcel.isArchived else { return nil }
        if !parcel.hasCarrierUpdate {
            // Asked about for the first time: there is nothing to judge yet.
            if parcel.syncStatus == .pending || parcel.syncStatus == .syncing { return nil }
            if parcel.carrier == .unknown { self = .unknown; return }
        }
        guard showsHistory else { return nil }
        self = .found
    }
}

extension Parcel {
    /// What the page ends on: its newest scan, and how many it has. Empty before the first one.
    var feedbackScan: String {
        currentEvent.map { "\(trackingEvents.count):\($0.occurredAt)" } ?? ""
    }
}

/// The parcel a question is about, as this iPhone remembers it.
enum ParcelFeedbackSubject: Equatable, Sendable {
    /// One of the account's parcels, or one this iPhone follows itself.
    case parcel(UUID)
    /// A parcel opened through someone's link.
    case link(String)

    /// A link's id opens its parcel, so only its digest is kept.
    var memoryKey: String {
        switch self {
        case .parcel(let id): id.uuidString
        case .link(let id): SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined()
        }
    }
}

/// What this iPhone remembers of the question, one entry per parcel: when its reader last
/// answered and about which scan, and the scan the way back from a carrier's site last asked
/// about. A scan is asked about once, and a parcel at most once a day. Nothing of it leaves
/// the device.
struct ParcelFeedbackMemory {
    private static let key = "sdt.parcelFeedback.v1"
    /// Only the latest parcels can still matter.
    static let limit = 200
    /// How long an answer keeps the question away.
    static let quiet: TimeInterval = 24 * 60 * 60

    private struct Entry: Codable {
        var answeredAt: Date?
        /// What the page ended on when its reader answered. Nil for "not yet", which answers for a day only.
        var scan: String?
        /// The scan the question was asked about on the way back.
        var back: String?
        var savedAt: Date
    }

    private let defaults: UserDefaults
    private let now: () -> Date

    init(defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.now = now
    }

    /// Whether the standing question rests: its reader answered about this scan, or answered
    /// within the last day. Only another scan and a day together bring it back.
    func rests(_ subject: ParcelFeedbackSubject, scan: String) -> Bool {
        guard let entry = read()[subject.memoryKey], let answeredAt = entry.answeredAt else { return false }
        if entry.scan == scan { return true }
        // A clock set back must not keep a new scan from being asked about.
        let age = now().timeIntervalSince(answeredAt)
        return age >= 0 && age < Self.quiet
    }

    /// Whether the way back may ask about this scan: once, and only while the standing question is asked.
    func asksOnReturn(_ subject: ParcelFeedbackSubject, scan: String) -> Bool {
        read()[subject.memoryKey]?.back != scan && !rests(subject, scan: scan)
    }

    /// An answer about what the page ends on. Without a scan it is about none: it rests the question for a day only.
    func rememberAnswer(_ subject: ParcelFeedbackSubject, scan: String?) {
        update(subject) {
            $0.answeredAt = now()
            $0.scan = scan
        }
    }

    func rememberAskedOnReturn(_ subject: ParcelFeedbackSubject, scan: String) {
        update(subject) { $0.back = scan }
    }

    func forgetAll() {
        defaults.removeObject(forKey: Self.key)
    }

    private func update(_ subject: ParcelFeedbackSubject, _ change: (inout Entry) -> Void) {
        var entries = read()
        var entry = entries[subject.memoryKey] ?? Entry(savedAt: now())
        change(&entry)
        entry.savedAt = now()
        entries[subject.memoryKey] = entry
        let kept = entries.sorted { $0.value.savedAt > $1.value.savedAt }.prefix(Self.limit)
        defaults.set(try? JSONEncoder().encode(Dictionary(uniqueKeysWithValues: kept.map { ($0.key, $0.value) })), forKey: Self.key)
    }

    private func read() -> [String: Entry] {
        defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode([String: Entry].self, from: $0) } ?? [:]
    }
}

extension ParcelFeedbackRequest {
    static let noteLimit = 1_000
    static let carrierNameLimit = 120
    static let trackingPageLimit = 500

    /// What is shown is right. It comes alone.
    static func right(id: UUID = UUID(), asked: ParcelFeedbackRequestAsked, language: AppLanguage) -> ParcelFeedbackRequest {
        ParcelFeedbackRequest(id: id, answer: .right, asked: asked, app: .ios, locale: locale(language))
    }

    /// What is off: reasons in the order the page offers them, a note, or both.
    static func wrong(id: UUID = UUID(), reasons: Set<ParcelFeedbackReason>, note: String = "",
                      asked: ParcelFeedbackRequestAsked, language: AppLanguage) -> ParcelFeedbackRequest {
        let ordered = ParcelFeedbackReason.allCases.filter(reasons.contains)
        return ParcelFeedbackRequest(id: id, answer: .wrong, reasons: ordered.isEmpty ? nil : ordered,
                                     note: words(note, limit: noteLimit), asked: asked, app: .ios, locale: locale(language))
    }

    /// Who carries a parcel no carrier was found for: a name, its tracking page as typed, or both.
    static func foundElsewhere(id: UUID = UUID(), carrierName: String, trackingPage: String, language: AppLanguage) -> ParcelFeedbackRequest {
        ParcelFeedbackRequest(id: id, answer: .foundElsewhere, carrierName: words(carrierName, limit: carrierNameLimit),
                              trackingPage: words(trackingPage, limit: trackingPageLimit), asked: .page, app: .ios, locale: locale(language))
    }

    /// Typed words as an answer carries them: without the space around them, within their limit, nil when nothing is left.
    static func words(_ text: String, limit: Int) -> String? {
        limited(text.trimmingCharacters(in: .whitespacesAndNewlines), to: limit).nonEmpty
    }

    /// What is being typed, kept within what an answer may carry. Whole characters only.
    static func limited(_ text: String, to limit: Int) -> String {
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

    private static func locale(_ language: AppLanguage) -> NativePushLocale {
        NativePushLocale(rawValue: language.rawValue) ?? .en
    }
}

extension ParcelFeedbackModel.Page {
    /// What a parcel's page asks about, or nil while it asks nothing. A made-up parcel, as the
    /// demo tells its stories with, is not something to judge.
    init?(parcel: Parcel, subject: ParcelFeedbackSubject, showsHistory: Bool, madeUp: Bool, carrier: String, language: AppLanguage) {
        guard !madeUp, let question = ParcelFeedbackQuestion(parcel: parcel, showsHistory: showsHistory) else { return nil }
        self.init(subject: subject, question: question, scan: parcel.feedbackScan, carrier: carrier, language: language)
    }
}

/// How a page sends an answer: to the service as the account, through the parcel's link, or
/// nowhere in the demo.
struct ParcelFeedbackClient {
    var send: @MainActor (ParcelFeedbackRequest) async throws -> Void
}

/// The question on one page: what stands where it is asked, the sheets that take the words, and
/// the word said at the bottom of the page. An answer shows at once, and is taken back if it
/// could not be sent.
@MainActor
final class ParcelFeedbackModel: ObservableObject {
    /// What stands where the question is asked.
    enum Moment: Equatable {
        case ask
        /// "Not quite": the reasons are offered, nothing is sent yet.
        case reasons
        case right
        /// A reason was given in place; a note may follow it.
        case sent
        /// The words were sent: there is nothing to add.
        case noted
        /// "Not yet": the carrier's own site does not show the parcel either.
        case early
        /// The reader named the carrier.
        case named
    }

    /// What a page shows of its parcel, as far as the question goes.
    struct Page: Equatable {
        var subject: ParcelFeedbackSubject
        var question: ParcelFeedbackQuestion
        /// What the page ends on (`Parcel.feedbackScan`).
        var scan: String
        /// The carrier's name, for the line that says what an answer carries.
        var carrier: String
        /// The language the page speaks, which an answer says too.
        var language: AppLanguage
    }

    /// The sheet that takes what is off.
    struct Words: Identifiable, Equatable {
        /// The answer's id: a note added to an answer already sent goes under the same one.
        let id: UUID
        var reasons: Set<ParcelFeedbackReason>
        let asked: ParcelFeedbackRequestAsked
    }

    /// A word at the bottom of the page.
    enum Word: Equatable {
        /// Asked on the way back from a carrier's own site, named as its link names it.
        case back(site: String)
        case backRight
        case backSent
        case failed

        /// The question waits this long for an answer; a word of thanks stays this long.
        var stay: Duration {
            if case .back = self { .seconds(12) } else { .seconds(4) }
        }
    }

    /// A page left for less than this was not compared with the carrier's.
    static let away: TimeInterval = 1.5

    @Published private(set) var page: Page?
    @Published private(set) var moment = Moment.ask
    @Published var words: Words?
    /// The sheet that asks who carries the parcel is open.
    @Published var namingCarrier = false
    @Published private(set) var word: Word?
    @Published private(set) var sending = false

    private let memory: ParcelFeedbackMemory
    private let now: () -> Date
    private let report: @MainActor (String, DeliveryAnalytics.Outcome) -> Void
    private var client: ParcelFeedbackClient?
    /// The reader answered for what the page ends on before this visit. An answer given on this visit stays to be read.
    private var rests = false
    /// The answer whose reason was given in place, for the note that may follow it.
    private var given: Words?
    /// The reader's leave for a carrier's own page, and when the app left the screen for it.
    private var visit: (site: String, left: Date?)?

    init(memory: ParcelFeedbackMemory = ParcelFeedbackMemory(), now: @escaping () -> Date = Date.init,
         report: @escaping @MainActor (String, DeliveryAnalytics.Outcome) -> Void = { DeliveryAnalytics.shared.action($0, $1) }) {
        self.memory = memory
        self.now = now
        self.report = report
    }

    /// The question standing on the page, or nil while there is none to ask.
    var standing: ParcelFeedbackQuestion? {
        guard let page, moment != .ask || !rests else { return nil }
        return page.question
    }

    /// Takes what the page shows now. Another parcel, or a carrier found while the page was open, starts over.
    func show(_ page: Page?, through client: ParcelFeedbackClient?) {
        self.client = client
        guard page != self.page else { return }
        let before = self.page
        self.page = page
        if before?.subject != page?.subject {
            words = nil
            namingCarrier = false
            word = nil
            visit = nil
        }
        if before?.subject != page?.subject || before?.question != page?.question {
            moment = .ask
            given = nil
        }
        rests = page.map { memory.rests($0.subject, scan: $0.scan) } ?? false
    }

    // MARK: - On the way back

    /// The reader opens a carrier's own page, named as its link names it.
    func visited(_ site: String) {
        guard page?.question == .found else { return }
        visit = (site, nil)
    }

    /// The app leaves the screen.
    func left() {
        guard let visit, visit.left == nil else { return }
        self.visit = (visit.site, now())
    }

    /// The app is back: the reader has just seen what the carrier's own site says. While something
    /// else is said or asked over the page, the question waits for another visit.
    func returned(busy: Bool = false) {
        guard let visit, let left = visit.left else { return }
        self.visit = nil
        guard let page, page.question == .found, !busy, words == nil, !namingCarrier,
              moment == .ask || moment == .reasons,
              now().timeIntervalSince(left) >= Self.away,
              memory.asksOnReturn(page.subject, scan: page.scan) else { return }
        // Asked once about a scan, answered or not.
        memory.rememberAskedOnReturn(page.subject, scan: page.scan)
        word = .back(site: visit.site)
    }

    /// A word leaves by itself once it has stayed its time.
    func wordLeft(_ word: Word) {
        if self.word == word { self.word = nil }
    }

    // MARK: - Answers

    /// What is shown is right: said in place, or on the way back.
    func right(_ asked: ParcelFeedbackRequestAsked = .page) async {
        guard let page, page.question == .found else { return }
        let before = moment
        moment = .right
        word = asked == .back ? .backRight : nil
        if await deliver(.right(asked: asked, language: page.language), for: page) { return }
        guard self.page?.subject == page.subject else { return }
        moment = before
        word = .failed
    }

    func notQuite() {
        guard moment == .ask else { return }
        moment = .reasons
    }

    /// One reason, given in place.
    func pick(_ reason: ParcelFeedbackReason) async {
        guard let page, moment == .reasons else { return }
        let answer = Words(id: UUID(), reasons: [reason], asked: .page)
        given = answer
        moment = .sent
        if await deliver(.wrong(id: answer.id, reasons: answer.reasons, asked: .page, language: page.language), for: page) { return }
        guard self.page?.subject == page.subject else { return }
        given = nil
        moment = .reasons
        word = .failed
    }

    /// More to say about the reason just given.
    func addNote() {
        guard moment == .sent, let given else { return }
        words = given
    }

    /// The carrier's own site says something else.
    func wrongOnReturn() {
        word = nil
        words = Words(id: UUID(), reasons: [], asked: .back)
    }

    /// The carrier's own site shows the parcel: the reader says whose it is.
    func elsewhere() {
        namingCarrier = true
    }

    /// Nothing to send: tomorrow the carrier's site may show it, so the answer is about no scan.
    func notYet() {
        guard let page, page.question == .unknown else { return }
        memory.rememberAnswer(page.subject, scan: nil)
        moment = .early
    }

    /// Sends what the open sheet holds. False keeps the sheet open with what was typed.
    func sendWords(_ reasons: Set<ParcelFeedbackReason>, note: String) async -> Bool {
        guard let page, let words, !sending else { return false }
        sending = true
        defer { sending = false }
        // A note added to the reason given in place is the same answer: it is not counted twice.
        let feedback = ParcelFeedbackRequest.wrong(id: words.id, reasons: reasons, note: note, asked: words.asked, language: page.language)
        guard await deliver(feedback, for: page, counted: words.asked == .back) else { return false }
        guard self.page?.subject == page.subject else { return true }
        self.words = nil
        if self.page?.question == .found { moment = .noted }
        if words.asked == .back { word = .backSent }
        return true
    }

    /// Sends who carries the parcel. False keeps the sheet open with what was typed.
    func sendCarrier(name: String, page address: String) async -> Bool {
        guard let page, !sending else { return false }
        sending = true
        defer { sending = false }
        guard await deliver(.foundElsewhere(carrierName: name, trackingPage: address, language: page.language), for: page) else { return false }
        guard self.page?.subject == page.subject else { return true }
        namingCarrier = false
        if self.page?.question == .unknown { moment = .named }
        return true
    }

    /// Sends an answer, and remembers it once the service has it.
    private func deliver(_ feedback: ParcelFeedbackRequest, for page: Page, counted: Bool = true) async -> Bool {
        let action = switch feedback.answer {
        case .right: "parcel-feedback-right"
        case .wrong: "parcel-feedback-wrong"
        case .foundElsewhere: "parcel-feedback-carrier"
        }
        do {
            guard let client else { throw DeliveryAPIError.parcelMissing }
            try await client.send(feedback)
            if counted { report(action, .success) }
            memory.rememberAnswer(page.subject, scan: page.scan)
            return true
        } catch {
            if counted { report(action, .error) }
            return false
        }
    }
}

#if DEBUG
extension ParcelFeedbackModel {
    /// Puts the question in the state `ParcelFeedbackPreview` names, whatever was answered before.
    func preview(_ variant: String) {
        guard let page else { return }
        rests = false
        given = Words(id: UUID(), reasons: [.steps], asked: .page)
        switch variant {
        case "reasons": moment = .reasons
        case "right": moment = .right
        case "sent": moment = .sent
        case "noted": moment = .noted
        case "early": moment = .early
        case "named": moment = .named
        case "back": word = .back(site: page.carrier)
        case "backSent": (moment, word) = (.noted, .backSent)
        case "failed": word = .failed
        case "words": words = given
        case "carrier": namingCarrier = true
        default: moment = .ask
        }
    }
}
#endif
