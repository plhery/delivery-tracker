import SwiftUI
import UIKit

/// Sharing one of the account's parcels from its detail: what the link shows, as the other
/// person will see it, the switches that change it, the link, and the way to stop. The name, a
/// gift's note and who it is from are added to the link after its `#`: they reach the recipient
/// and no server. The link stands under the switches, so what is copied carries what was chosen.
struct ParcelShareSheet: View {
    let parcel: Parcel
    /// The demo's links are made up on this device: the sheet says so.
    let demo: Bool

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ParcelShareModel
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
        VStack(spacing: 12) {
            SharePreviewCard(parcel: parcel, name: model.carried.name, showNumber: model.shown.showNumber, gift: model.shown.gift)
            options
            if model.shown.gift { giftWords }
            linkRow
        }
        if demo { line(localizer.text("alerts.demo"), symbol: "info.circle") }
        if let failure = model.failureKey { warning(localizer.text(failure)) }
        VStack(spacing: 2) {
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
                        .font(.footnote)
                        .underline()
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .disabled(model.working)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.horizontal, 2)
            }
        }
    }

    /// What the link shows beyond the journey: one line each, in one card. The card above them
    /// shows what they change. A parcel without a name has no name to show.
    private var options: some View {
        VStack(spacing: 0) {
            switchRow(symbol: "receipt", title: localizer.text("share.number.title"), isOn: binding(.showNumber))
            if let name = model.name {
                hairline
                switchRow(symbol: "pencil", title: localizer.text("share.name.title"), value: name,
                          isOn: Binding { model.words.name } set: { model.words.name = $0 })
            }
            hairline
            switchRow(symbol: "gift", title: localizer.text("share.gift.title"), isOn: binding(.gift))
        }
        .background(Brand.paper, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var hairline: some View {
        Rectangle().fill(Brand.separator.opacity(0.5)).frame(height: 1)
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
            .disabled(model.loading || model.working || model.savingChanges)
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .frame(minHeight: 56)
        .background(Brand.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.separator.opacity(0.6)))
    }

    private func switchRow(symbol: String, title: String, value: String? = nil, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            HStack(spacing: 0) {
                Image(systemName: symbol)
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                    .frame(width: 22)
                    .padding(.trailing, 12)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
                if let value {
                    Spacer(minLength: 10)
                    Text(value)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
        }
        .tint(ExperimentalPalette.delivered)
        .disabled(model.loading)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .frame(minHeight: 50)
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
        .disabled(model.working || model.savingChanges)
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

/// What the link shows, as a small card: the switches under it change it, so none of them
/// needs a sentence. A gift on its way is the wrapped parcel, with no number and no name.
private struct SharePreviewCard: View {
    let parcel: Parcel
    /// The name the link carries, when it carries one.
    let name: String?
    let showNumber: Bool
    let gift: Bool

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dynamicTypeSize) private var typeSize
    @ObservedObject private var catalog = CarrierCatalog.shared

    private var delivered: Bool { parcel.currentStage == .delivered }
    private var wrapped: Bool { gift && !delivered }

    var body: some View {
        let identity = CarrierVisualIdentity.of(parcel.displayedCarrier, catalog: catalog, language: localizer.language)
        // Handed from one carrier to another, or about to be, it carries both marks, as the page does.
        let delivery = parcel.deliveringCarrier.map { CarrierVisualIdentity.of($0, catalog: catalog, language: localizer.language) }
        VStack(alignment: .leading, spacing: 8) {
            Text(localizer.text(wrapped ? "share.preview.wrapped" : "share.preview.title"))
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 2)
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    VStack(alignment: .leading, spacing: 7) {
                        CarrierFleetMark(identity: identity)
                        if let delivery { CarrierFleetMark(identity: delivery) }
                    }
                    .padding(.bottom, 4)
                    if let name, !wrapped {
                        Text(gift ? localizer.text("share.gift.inside") + " " + name : name)
                            .font(.footnote.weight(.semibold))
                    }
                    Text(headline).font(.title3.weight(.semibold))
                    if let detail {
                        Text(detail)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(gift ? ExperimentalPalette.lilac : identity.ink)
                    }
                    if !wrapped {
                        Text(number)
                            .font(.system(.caption, design: .monospaced))
                            .padding(.top, 3)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                if !typeSize.isAccessibilitySize { figure(identity) }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(gift ? ExperimentalPalette.lilacSurface : identity.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var headline: String {
        wrapped ? localizer.text("share.gift.headline") : gift ? localizer.text("share.gift.here") : localizer.parcelStatus(parcel)
    }

    private var detail: String? {
        gift ? localizer.giftDetail(parcel, opened: delivered) ?? (delivered ? localizer.sharedParcelDetail(parcel) : nil)
            : localizer.sharedParcelDetail(parcel)
    }

    /// The number as the link shows it: whole, or its end alone.
    private var number: String {
        showNumber ? CarrierCatalog.format(parcel.trackingNumber, carrier: parcel.carrier) : ParcelNumberHint(hiding: parcel.trackingNumber).masked
    }

    /// The part of Pip's frame that holds the closed box, and the part its open flaps and card reach into.
    private static let closedBox = CGRect(x: 48, y: 88, width: 204, height: 196)
    private static let openBox = CGRect(x: 10, y: 28, width: 280, height: 256)
    private static let boxWidth: CGFloat = 78

    /// Pip, as on the page: the kraft parcel while it travels, the open box once it has arrived, a ribbon for a gift.
    /// Its side carries the carrier's label, with the number as the link shows it; a gift has none, nor has a
    /// number no carrier knows.
    @ViewBuilder private func figure(_ identity: CarrierVisualIdentity) -> some View {
        let known = parcel.carrier != .unknown || parcel.hasCarrierUpdate
        let label = known && !gift ? PipLabel(identity: identity, number: number) : nil
        if gift || delivered {
            // Drawn at the sticker's scale and cut to the box, without the shadow under it.
            let scale = Self.boxWidth / Self.closedBox.width
            let crop = delivered ? Self.openBox : Self.closedBox
            UnwrappingParcel(open: delivered ? 1 : 0, label: label, ribbon: gift, grounded: false)
                .frame(width: PipGeometry.frame.width * scale, height: PipGeometry.frame.height * scale)
                .offset(x: -crop.minX * scale, y: -crop.minY * scale)
                .frame(width: crop.width * scale, height: crop.height * scale, alignment: .topLeading)
                .clipped()
                .padding(.vertical, delivered ? -8 : 0)
                .accessibilityHidden(true)
        } else {
            SmallPip(label: label).frame(width: Self.boxWidth)
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
/// with its note), `stopped` or `delivered` (a parcel that has arrived, its name shown). Start
/// the demo with `-sdt.native.experience.v1 demo`.
enum ParcelSharePreview {
    static var variant: String? { UserDefaults.standard.string(forKey: "sdt.debug.parcelShare") }

    /// The demo parcel the sheet opens for.
    static func parcel(in parcels: [Parcel]) -> Parcel? {
        guard let variant else { return nil }
        if variant == "delivered", let arrived = parcels.first(where: { $0.currentStage == .delivered }) { return arrived }
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
        case "delivered":
            _ = shares.share(parcel.id, showNumber: false, gift: false)
            notes.remember(ParcelShareWords(name: true, note: "", from: ""), for: parcel.id)
        default:
            break
        }
    }
}
#endif
