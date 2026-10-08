import SwiftUI
import UIKit

/// The standing question, where a page's history ends: Pip's for a parcel a carrier answers
/// for, a row for one none was found for. An answer is given in place; a sheet takes the words.
struct ParcelFeedbackQuestionView: View {
    @ObservedObject var model: ParcelFeedbackModel

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            switch model.standing {
            case .found: pip
            case .unknown: row
            case nil: EmptyView()
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: model.moment)
    }

    /// Pip stands beside what he says. At the largest text sizes the words take his room.
    private var pip: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if !typeSize.isAccessibilitySize {
                SmallPip()
                    .frame(width: 50)
                    .padding(.leading, -2)
                    .padding(.bottom, -3)
            }
            bubble
        }
    }

    private var bubble: some View {
        // The corner beside Pip is the bubble's tail.
        let shape = UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: typeSize.isAccessibilitySize ? 18 : 5,
                                           bottomTrailingRadius: 18, topTrailingRadius: 18, style: .continuous)
        let offering = model.moment == .reasons
        return Group {
            switch model.moment {
            case .right:
                said("feedback.pip.right")
            case .sent:
                beside {
                    said("feedback.pip.sent")
                } then: {
                    Button { model.addNote() } label: {
                        Text(localizer.text("feedback.addNote"))
                            .font(.caption)
                            .underline(color: Brand.inkSoft.opacity(0.45))
                            .frame(minHeight: 36)
                            .padding(.trailing, 6)
                            .padding(.vertical, 4)
                            .contentShape(Rectangle())
                            .padding(.vertical, -4)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Brand.inkSoft)
                }
            case .noted:
                said("feedback.pip.sent")
            case .reasons:
                VStack(alignment: .leading, spacing: 10) {
                    question("feedback.whatsOff")
                    FeedbackFlow(spacing: 6) {
                        ForEach(ParcelFeedbackReason.allCases) { reason in
                            FeedbackPill(title: localizer.text(reason.labelKey)) { Task { await model.pick(reason) } }
                        }
                    }
                }
            case .ask, .early, .named:
                beside {
                    question("feedback.pip.question")
                } then: {
                    HStack(spacing: 6) {
                        FeedbackPill(title: localizer.text("feedback.yes")) { Task { await model.right() } }
                        FeedbackPill(title: localizer.text("feedback.notQuite")) { model.notQuite() }
                    }
                }
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, offering ? 12 : 8)
        .padding(.vertical, offering ? 12 : 8)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .background(Brand.paper, in: shape)
        .overlay(shape.strokeBorder(Brand.separator.opacity(0.6)))
    }

    /// No Pip here: he found nothing to show.
    private var row: some View {
        Group {
            switch model.moment {
            case .early:
                said("feedback.unknown.early")
            case .named:
                said("feedback.unknown.sent")
            case .ask, .reasons, .right, .sent, .noted:
                beside {
                    question("feedback.unknown.question")
                } then: {
                    HStack(spacing: 6) {
                        FeedbackPill(title: localizer.text("feedback.yes"), onControl: true) { model.elsewhere() }
                        FeedbackPill(title: localizer.text("feedback.unknown.notYet"), onControl: true) { model.notYet() }
                    }
                }
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .background(Brand.ink.opacity(0.07), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    /// Side by side while both fit on a line; else the second goes under the first.
    private func beside(@ViewBuilder _ first: () -> some View, @ViewBuilder then second: () -> some View) -> some View {
        let first = first()
        let second = second()
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) {
                first
                Spacer(minLength: 12)
                second
            }
            VStack(alignment: .leading, spacing: 8) {
                first
                second
            }
        }
    }

    private func question(_ key: String) -> some View {
        Text(localizer.text(key))
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Brand.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// A word of thanks, in the green of a parcel that arrived.
    private func said(_ key: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Image(systemName: "checkmark").font(.footnote.weight(.semibold)).accessibilityHidden(true)
            Text(localizer.text(key)).fixedSize(horizontal: false, vertical: true)
        }
        .font(.footnote.weight(.medium))
        .foregroundStyle(ExperimentalPalette.delivered)
        .padding(.trailing, 6)
    }
}

extension ParcelFeedbackReason {
    var labelKey: String {
        switch self {
        case .arrived: "feedback.reason.arrived"
        case .status: "feedback.reason.status"
        case .steps: "feedback.reason.steps"
        case .timePlace: "feedback.reason.timePlace"
        case .carrier: "feedback.reason.carrier"
        case .other: "feedback.reason.other"
        }
    }
}

/// A small answer. On paper it is a soft control; on a control's fill it is paper with a hairline.
private struct FeedbackPill: View {
    let title: String
    var onControl = false
    let action: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        Button(action: action) {
            Text(title)
                .font(.footnote.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .frame(minHeight: 36)
                .background(onControl ? Brand.paper : Brand.ink.opacity(0.07), in: shape)
                .overlay { if onControl { shape.strokeBorder(Brand.separator.opacity(0.6)) } }
                // 44 pt to the touch, in the room of 36.
                .padding(.vertical, 4)
                .contentShape(Rectangle())
                .padding(.vertical, -4)
        }
        .buttonStyle(TactileButtonStyle(scale: 0.96))
        .foregroundStyle(Brand.ink)
    }
}

/// Lays its pills out like words: one that does not fit on the line starts the next.
private struct FeedbackFlow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let lines = lines(of: subviews, in: proposal.width ?? .infinity)
        let height = lines.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, lines.count - 1))
        return CGSize(width: lines.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for line in lines(of: subviews, in: bounds.width) {
            var x = bounds.minX
            for (index, size) in line.items {
                subviews[index].place(at: CGPoint(x: x, y: y + (line.height - size.height) / 2),
                                      proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += line.height + spacing
        }
    }

    private struct Line {
        var items: [(index: Int, size: CGSize)] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func lines(of subviews: Subviews, in width: CGFloat) -> [Line] {
        var lines = [Line()]
        for index in subviews.indices {
            // A pill wider than the line wraps its own words.
            let size = subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil))
            if let last = lines.last, !last.items.isEmpty, last.width + spacing + size.width > width { lines.append(Line()) }
            let line = lines.count - 1
            lines[line].width += (lines[line].items.isEmpty ? 0 : spacing) + size.width
            lines[line].height = max(lines[line].height, size.height)
            lines[line].items.append((index, size))
        }
        return lines
    }
}

// MARK: - Over the page

extension View {
    /// What the question lays over its page: the one asked on the way back from a carrier's
    /// site, the sheets, and the words that follow them. While `busy`, something else is said
    /// or asked over the page, and the way back asks nothing.
    func parcelFeedback(_ model: ParcelFeedbackModel, busy: Bool = false) -> some View {
        modifier(ParcelFeedbackOverlays(model: model, busy: busy))
    }
}

private struct ParcelFeedbackOverlays: ViewModifier {
    @ObservedObject var model: ParcelFeedbackModel
    let busy: Bool

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) { word }
            .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.4, dampingFraction: 0.86), value: model.word)
            .sheet(item: $model.words) { words in
                ParcelFeedbackWordsSheet(model: model, words: words)
                    .environmentObject(localizer)
            }
            .sheet(isPresented: $model.namingCarrier) {
                ParcelFeedbackCarrierSheet(model: model)
                    .environmentObject(localizer)
            }
            // A sheet shown from UIKit does not hear the scene's phase: the app's own notices reach every page.
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in model.left() }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in model.returned(busy: busy) }
            .task(id: model.word) {
                guard let word = model.word else { return }
                try? await Task.sleep(for: word.stay)
                if !Task.isCancelled { model.wordLeft(word) }
            }
            .onChange(of: model.word) { _, word in
                if let word { AccessibilityNotification.Announcement(text(word)).post() }
            }
            .onChange(of: model.moment) { _, moment in
                // An answer given on the way back is said by its own word.
                guard model.word == nil, let thanks = thanks(moment) else { return }
                AccessibilityNotification.Announcement(localizer.text(thanks)).post()
            }
            #if DEBUG
            .onChange(of: model.page?.subject, initial: true) { _, subject in
                if subject != nil, let variant = ParcelFeedbackPreview.variant { model.preview(variant) }
            }
            #endif
    }

    @ViewBuilder private var word: some View {
        if let word = model.word {
            Group {
                switch word {
                case .back:
                    InlineToast(text: text(word), symbol: "arrow.up.right", tint: Brand.inkSoft, answers: [
                        InlineToast.Answer(title: localizer.text("feedback.yes")) { Task { await model.right(.back) } },
                        InlineToast.Answer(title: localizer.text("feedback.no")) { model.wrongOnReturn() },
                    ])
                case .backRight, .backSent:
                    InlineToast(text: text(word), button: nil, tint: ExperimentalPalette.delivered, action: nil)
                case .failed:
                    InlineToast(text: text(word), button: nil, symbol: "exclamationmark.triangle.fill", tint: Brand.warning, action: nil)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
            .frame(maxWidth: 560)
            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func text(_ word: ParcelFeedbackModel.Word) -> String {
        switch word {
        case .back(let site): localizer.text("feedback.back.question", ["site": site])
        case .backRight: localizer.text("feedback.back.right")
        case .backSent: localizer.text("feedback.back.sent")
        case .failed: localizer.text("feedback.failed")
        }
    }

    /// What the page says in place once an answer is given.
    private func thanks(_ moment: ParcelFeedbackModel.Moment) -> String? {
        switch moment {
        case .right: "feedback.pip.right"
        case .sent, .noted: "feedback.pip.sent"
        case .early: "feedback.unknown.early"
        case .named: "feedback.unknown.sent"
        case .ask, .reasons: nil
        }
    }
}

// MARK: - Sheets

/// What is off: the reasons, several at once, and a note for what they do not say.
private struct ParcelFeedbackWordsSheet: View {
    @ObservedObject var model: ParcelFeedbackModel

    @EnvironmentObject private var localizer: Localizer
    @State private var reasons: Set<ParcelFeedbackReason>
    @State private var note = ""
    @State private var failed = false
    @FocusState private var writing: Bool

    init(model: ParcelFeedbackModel, words: ParcelFeedbackModel.Words) {
        self.model = model
        _reasons = State(initialValue: words.reasons)
    }

    private var empty: Bool {
        reasons.isEmpty && ParcelFeedbackRequest.words(note, limit: ParcelFeedbackRequest.noteLimit) == nil
    }

    var body: some View {
        FeedbackSheet(title: localizer.text("feedback.whatsOff"), busy: model.sending, writing: writing) {
            FeedbackFlow(spacing: 6) {
                ForEach(ParcelFeedbackReason.allCases) { reason in chip(reason) }
            }
            FeedbackField(label: localizer.text("feedback.note"), focused: writing) { writing = true } input: {
                TextField(text: $note, prompt: Text(verbatim: ""), axis: .vertical) { Text(localizer.text("feedback.note")) }
                    .lineLimit(2...6)
                    .focused($writing)
            }
            if failed { FeedbackFailure() }
            FeedbackSendButton(busy: model.sending, disabled: empty, action: send)
            FeedbackPromise(text: localizer.text("feedback.promise", ["carrier": model.page?.carrier ?? ""]))
        }
        .onChange(of: note) { _, typed in
            let kept = ParcelFeedbackRequest.limited(typed, to: ParcelFeedbackRequest.noteLimit)
            if kept != typed { note = kept }
        }
    }

    private func chip(_ reason: ParcelFeedbackReason) -> some View {
        let on = reasons.contains(reason)
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        return Button {
            if on { reasons.remove(reason) } else { reasons.insert(reason) }
            UISelectionFeedbackGenerator().selectionChanged()
        } label: {
            Text(localizer.text(reason.labelKey))
                .font(.footnote.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(minHeight: 44)
                .background(on ? ExperimentalPalette.ochreSurface : Brand.paper, in: shape)
                .overlay(shape.strokeBorder(on ? ExperimentalPalette.ochre : Brand.separator.opacity(0.6), lineWidth: on ? 1.5 : 1))
                .contentShape(shape)
        }
        .buttonStyle(TactileButtonStyle(scale: 0.97))
        .foregroundStyle(Brand.ink)
        .disabled(model.sending)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func send() {
        Task {
            failed = false
            failed = !(await model.sendWords(reasons, note: note))
        }
    }
}

/// Who carries a parcel no carrier was found for, and where its own site shows it.
private struct ParcelFeedbackCarrierSheet: View {
    @ObservedObject var model: ParcelFeedbackModel

    @EnvironmentObject private var localizer: Localizer
    @State private var who = ""
    @State private var page = ""
    @State private var failed = false
    @FocusState private var writing: Field?

    private enum Field { case who, page }

    private var empty: Bool {
        ParcelFeedbackRequest.words(who, limit: ParcelFeedbackRequest.carrierNameLimit) == nil
            && ParcelFeedbackRequest.words(page, limit: ParcelFeedbackRequest.trackingPageLimit) == nil
    }

    var body: some View {
        FeedbackSheet(title: localizer.text("feedback.unknown.title"), busy: model.sending, writing: writing != nil) {
            FeedbackField(label: localizer.text("feedback.unknown.who"), focused: writing == .who) { writing = .who } input: {
                TextField(text: $who, prompt: Text(verbatim: "")) { Text(localizer.text("feedback.unknown.who")) }
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($writing, equals: .who)
                    .onSubmit { writing = .page }
            }
            FeedbackField(label: localizer.text("feedback.unknown.where"), focused: writing == .page) { writing = .page } input: {
                // An address as its reader has it, with or without its scheme: a person reads it, nothing opens it.
                TextField(text: $page, prompt: Text(verbatim: "")) { Text(localizer.text("feedback.unknown.where")) }
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .focused($writing, equals: .page)
                    .onSubmit { if !empty { send() } }
            }
            if failed { FeedbackFailure() }
            FeedbackSendButton(busy: model.sending, disabled: empty, action: send)
            FeedbackPromise(text: localizer.text("feedback.unknown.promise"))
        }
        .onChange(of: who) { _, typed in
            let kept = ParcelFeedbackRequest.limited(typed, to: ParcelFeedbackRequest.carrierNameLimit)
            if kept != typed { who = kept }
        }
        .onChange(of: page) { _, typed in
            let kept = ParcelFeedbackRequest.limited(typed, to: ParcelFeedbackRequest.trackingPageLimit)
            if kept != typed { page = kept }
        }
    }

    private func send() {
        Task {
            failed = false
            failed = !(await model.sendCarrier(name: who, page: page))
        }
    }
}

/// A sheet as tall as what it asks, which opens fully once its reader writes.
private struct FeedbackSheet<Content: View>: View {
    let title: String
    let busy: Bool
    let writing: Bool
    @ViewBuilder let content: () -> Content

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @State private var contentHeight: CGFloat = 400
    @State private var detent = PresentationDetent.height(400)

    private var fitted: PresentationDetent { .height(contentHeight) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center, spacing: 16) {
                    Text(title)
                        .font(.title2.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityAddTraits(.isHeader)
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .frame(width: 36, height: 36)
                            .background(Brand.ink.opacity(0.07), in: Circle())
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                    .accessibilityLabel(localizer.text("common.close"))
                }
                content()
            }
            .padding(.horizontal, 22)
            .padding(.top, 26)
            .padding(.bottom, 18)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.interactively)
        .background(Brand.background)
        .tint(Brand.ink)
        .environment(\.locale, localizer.language.locale)
        .presentationDetents([fitted, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationBackground(Brand.background)
        .interactiveDismissDisabled(busy)
        .onChange(of: fitted, initial: true) { _, fitted in
            if detent != .large { detent = fitted }
        }
        .onChange(of: writing) { _, writing in
            if writing { detent = .large }
        }
    }
}

/// A field with its label above it. A tap anywhere in its frame starts writing.
private struct FeedbackField<Input: View>: View {
    let label: String
    let focused: Bool
    let focus: () -> Void
    @ViewBuilder let input: () -> Input

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        VStack(alignment: .leading, spacing: 6) {
            // The field says its own label aloud.
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 2)
                .accessibilityHidden(true)
            input()
                .font(.callout)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(minHeight: 50)
                .background(Brand.paper, in: shape)
                .overlay(shape.strokeBorder(focused ? ExperimentalPalette.ochre : Brand.separator.opacity(0.6), lineWidth: focused ? 1.5 : 1))
                .contentShape(shape)
                .onTapGesture(perform: focus)
        }
    }
}

private struct FeedbackSendButton: View {
    let busy: Bool
    /// Nothing to send yet.
    let disabled: Bool
    let action: () -> Void

    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                if busy { ProgressView().tint(Brand.onAccent) }
                Text(localizer.text(busy ? "feedback.sending" : "feedback.send")).multilineTextAlignment(.center)
            }
            .font(.headline)
            .foregroundStyle(Brand.onAccent)
            .padding(.horizontal, 20)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Brand.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(TactileButtonStyle())
        .disabled(busy || disabled)
        .opacity(disabled && !busy ? 0.45 : 1)
    }
}

/// The answer could not be sent; what was typed stays.
private struct FeedbackFailure: View {
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.circle").accessibilityHidden(true)
            Text(localizer.text("feedback.failed")).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.footnote)
        .foregroundStyle(Brand.warning)
        .padding(12)
        .background(Brand.warningSoft.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onAppear { AccessibilityNotification.Announcement(localizer.text("feedback.failed")).post() }
    }
}

/// What an answer carries, said under the button that sends it.
private struct FeedbackPromise: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity)
    }
}

#if DEBUG
/// Opens a demo parcel's page at launch with its question in a given state, to look at it in
/// the simulator: `-sdt.debug.parcelFeedback ask`, `reasons`, `right`, `sent`, `noted`, `early`,
/// `named`, `back` (asked on the way back), `backSent`, `failed`, `words` or `carrier` (the
/// sheets). `-sdt.debug.parcelFeedback.parcel <id>` names the parcel. Start the demo with
/// `-sdt.native.experience.v1 demo`: it asks nothing of its parcels but under this argument.
enum ParcelFeedbackPreview {
    static var variant: String? { UserDefaults.standard.string(forKey: "sdt.debug.parcelFeedback") }

    /// The parcel whose page opens: the one named, else the one with the shortest history,
    /// whose question shows without a scroll.
    static func parcel(in parcels: [Parcel]) -> Parcel? {
        guard variant != nil else { return nil }
        if let named = UserDefaults.standard.string(forKey: "sdt.debug.parcelFeedback.parcel").flatMap({ UUID(uuidString: $0) }) {
            return parcels.first { $0.id == named }
        }
        return parcels.filter { $0.isActive && $0.hasCarrierUpdate }.min { $0.trackingEvents.count < $1.trackingEvents.count }
    }
}
#endif
