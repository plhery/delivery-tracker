import SwiftUI
import UIKit

/// Sharing one of the account's parcels from its detail: the parcel's link, what the link
/// shows, and the way to stop. The name, a gift's note and who it is from are added to the
/// link after its `#`: they reach the recipient and no server.
struct ParcelShareSheet: View {
    let parcel: Parcel
    /// The demo's links are made up on this device: the sheet says so.
    let demo: Bool

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ParcelShareModel
    @ObservedObject private var catalog = CarrierCatalog.shared
    @State private var handingOut: HandedAddress?
    @State private var copied = false
    /// The sheet is as tall as what it shows, and opens fully to write a gift's note.
    @State private var contentHeight: CGFloat = 470
    @State private var detent = PresentationDetent.height(470)
    @FocusState private var writing: WordsField?

    private enum WordsField { case note, from }

    private struct HandedAddress: Identifiable {
        let id = UUID()
        let url: URL
    }

    init(parcel: Parcel, client: ParcelShareModel.Client, demo: Bool) {
        self.parcel = parcel
        self.demo = demo
        _model = StateObject(wrappedValue: ParcelShareModel(parcelID: parcel.id, name: parcel.label, client: client))
    }

    private var fitted: PresentationDetent { .height(contentHeight) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if model.stopped { stoppedState } else { sharing }
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
        .interactiveDismissDisabled(model.working)
        .onChange(of: fitted, initial: true) { _, fitted in
            if detent != .large { detent = fitted }
        }
        .onChange(of: writing) { _, writing in
            if writing != nil { detent = .large }
        }
        .task {
            #if DEBUG
            ParcelSharePreview.prepare(parcel)
            #endif
            await model.load()
            #if DEBUG
            if ParcelSharePreview.variant == "stopped" { await model.stop() }
            #endif
        }
        .sheet(item: $handingOut) { address in
            LinkActivitySheet(url: address.url) { shared, error in
                if shared { DeliveryAnalytics.shared.action("parcel-link-share", .success) }
                else if error != nil {
                    DeliveryAnalytics.shared.action("parcel-link-share", .error)
                    model.handOutFailed()
                }
            }
            .presentationDetents([.medium, .large])
            .ignoresSafeArea()
        }
    }

    // MARK: - Parts

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            Text(model.name.map { localizer.text("share.titleNamed", ["name": $0]) } ?? localizer.text("share.title"))
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
            .disabled(model.working)
            .accessibilityLabel(localizer.text("common.close"))
        }
    }

    @ViewBuilder private var sharing: some View {
        linkRow
        VStack(spacing: 7) {
            switchRow(symbol: "receipt", title: localizer.text("share.number.title"),
                      hint: localizer.text("share.number.hint", ["number": ParcelNumberHint(hiding: parcel.trackingNumber).masked]),
                      isOn: binding(.showNumber), disabled: model.loading)
            switchRow(symbol: "pencil", title: localizer.text("share.name.title"),
                      hint: model.name == nil ? localizer.text("share.name.unnamed") : localizer.text("share.name.hint", ["name": fallbackName]),
                      isOn: Binding { model.name != nil && model.words.name } set: { model.words.name = $0 },
                      disabled: model.loading || model.name == nil)
            switchRow(symbol: "gift", title: localizer.text("share.gift.title"), hint: localizer.text("share.gift.hint"),
                      isOn: binding(.gift), disabled: model.loading)
            if model.shown.gift { giftWords }
        }
        Text(localizer.text("share.promise.account"))
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 2)
        if demo { line(localizer.text("alerts.demo"), symbol: "info.circle") }
        if let failure = model.failureKey { warning(localizer.text(failure)) }
        VStack(spacing: 4) {
            primaryButton(localizer.text("share.action"), symbol: "square.and.arrow.up") {
                Task {
                    guard let url = await model.addressToHandOut() else { return }
                    writing = nil
                    handingOut = HandedAddress(url: url)
                }
            }
            .disabled(model.loading)
            if model.link != nil {
                Button { Task { await model.stop() } } label: {
                    Text(localizer.text("share.stop"))
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .disabled(model.working)
            }
        }
    }

    /// Sharing was stopped: the link shows nothing, and sharing again makes a new one.
    @ViewBuilder private var stoppedState: some View {
        line(localizer.text("share.stopped.account"), symbol: "info.circle")
        if demo { line(localizer.text("alerts.demo"), symbol: "info.circle") }
        if let failure = model.failureKey { warning(localizer.text(failure)) }
        primaryButton(localizer.text("share.again"), symbol: nil) {
            Task { await model.shareAgain() }
        }
    }

    /// The link, or what stands in its place while there is none, and the way to copy it.
    private var linkRow: some View {
        HStack(spacing: 8) {
            Group {
                if model.loading {
                    ProgressView().controlSize(.small)
                } else if let address = model.address {
                    Text(address.absoluteString.replacingOccurrences(of: "^https?://", with: "", options: .regularExpression))
                        .font(.system(.footnote, design: .monospaced).weight(.medium))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .accessibilityLabel(localizer.text("share.address"))
                        .accessibilityValue(address.absoluteString)
                } else {
                    Text(localizer.text("share.pending"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: copy) {
                Label(localizer.text(copied ? "detail.copied" : "detail.copy"), systemImage: copied ? "checkmark" : "doc.on.doc")
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .background(Brand.ink.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(TactileButtonStyle())
            .disabled(model.loading || model.working)
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .frame(minHeight: 56)
        .background(Brand.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.separator.opacity(0.6)))
    }

    private func switchRow(symbol: String, title: String, hint: String, isOn: Binding<Bool>, disabled: Bool) -> some View {
        Toggle(isOn: isOn) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                    .frame(width: 22)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Text(hint).font(.caption).foregroundStyle(.secondary)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(ExperimentalPalette.delivered)
        .disabled(disabled)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 60)
        .background(Brand.paper, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    /// A gift's note and who it is from. They travel in the link and show once it is delivered.
    private var giftWords: some View {
        VStack(alignment: .leading, spacing: 10) {
            wordsField(localizer.text("share.gift.note"), .note) {
                TextField(text: $model.words.note, prompt: Text(verbatim: ""), axis: .vertical) { Text(localizer.text("share.gift.note")) }
                    .lineLimit(2...5)
            }
            wordsField(localizer.text("share.gift.from"), .from) {
                TextField(text: $model.words.from, prompt: Text(verbatim: "")) { Text(localizer.text("share.gift.from")) }
                    .textContentType(.name)
                    .submitLabel(.done)
                    .onSubmit { writing = nil }
            }
            Text(localizer.text("share.gift.private"))
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .background(Brand.paper, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func wordsField(_ label: String, _ which: WordsField, @ViewBuilder field: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
            field()
                .font(.subheadline)
                .focused($writing, equals: which)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(minHeight: 44)
                .background(Brand.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    private func primaryButton(_ title: String, symbol: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 9) {
                if model.working {
                    ProgressView().tint(Brand.onAccent)
                } else if let symbol {
                    Image(systemName: symbol).font(.body.weight(.semibold)).accessibilityHidden(true)
                }
                Text(title).multilineTextAlignment(.center)
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
        .disabled(model.working)
    }

    private func line(_ text: String, symbol: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: symbol).accessibilityHidden(true)
            Text(text).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.footnote)
        .padding(12)
        .background(Brand.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func warning(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.circle").accessibilityHidden(true)
            Text(text).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.footnote)
        .foregroundStyle(Brand.warning)
        .padding(12)
        .background(Brand.warningSoft.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: - Actions

    /// What others read in place of the name: "DHL parcel".
    private var fallbackName: String {
        localizer.text("share.name.fallback", ["carrier": catalog.info(for: parcel.displayedCarrier, language: localizer.language).displayName])
    }

    private func binding(_ field: ParcelShareModel.Field) -> Binding<Bool> {
        Binding {
            field == .gift ? model.shown.gift : model.shown.showNumber
        } set: { value in
            Task { await model.set(field, to: value) }
        }
    }

    private func copy() {
        Task {
            guard let url = await model.addressToHandOut() else { return }
            UIPasteboard.general.url = url
            DeliveryAnalytics.shared.action("parcel-link-share", .success)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            AccessibilityNotification.Announcement(localizer.text("link.copied")).post()
            copied = true
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
    }
}

/// The system's share sheet, with the parcel's link and nothing else.
private struct LinkActivitySheet: UIViewControllerRepresentable {
    let url: URL
    /// Whether the link was shared, and what went wrong if it was not. Neither when it was put away.
    let finished: (Bool, Error?) -> Void

    init(url: URL, finished: @escaping (Bool, Error?) -> Void) {
        self.url = url
        self.finished = finished
    }

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, shared, _, error in finished(shared, error) }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

#if DEBUG
/// Opens the share sheet of a demo parcel at launch, to look at it in the simulator:
/// `-sdt.debug.parcelShare new` (no link yet), `link` (shared, number shown), `gift` (a gift
/// with its note) or `stopped`. Start the demo with `-sdt.native.experience.v1 demo`.
enum ParcelSharePreview {
    static var variant: String? { UserDefaults.standard.string(forKey: "sdt.debug.parcelShare") }

    /// The demo parcel the sheet opens for.
    static func parcel(in parcels: [Parcel]) -> Parcel? {
        guard variant != nil else { return nil }
        return parcels.first { $0.carrier == .dhl && $0.isActive } ?? parcels.first
    }

    /// Puts the demo's link and this device's words in the state the variant names.
    static func prepare(_ parcel: Parcel) {
        guard let variant else { return }
        let shares = DemoParcelShares()
        let notes = ParcelShareNotes()
        shares.stop(parcel.id)
        notes.forget(parcel.id)
        switch variant {
        case "link", "stopped":
            _ = shares.share(parcel.id, showNumber: true, gift: false)
        case "gift":
            _ = shares.share(parcel.id, showNumber: false, gift: true)
            notes.remember(ParcelShareWords(name: true, note: "Happy birthday, Alex! I hope these keep up with you on the trails.", from: "Sam"), for: parcel.id)
        default:
            break
        }
    }
}
#endif
