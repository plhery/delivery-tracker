import SwiftUI
import UIKit

/// A parcel someone shared, opened over whatever was on screen: its card, its history, and one
/// button to keep it. Nothing here changes the parcel.
struct ParcelLinkSheet: View {
    @EnvironmentObject private var links: ParcelLinkStore
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var parcels: ParcelStore
    @EnvironmentObject private var localizer: Localizer

    @State private var adding = false
    @State private var refreshing = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                ExperimentalBackdrop()
                switch links.phase {
                case .loading:
                    ProgressView().controlSize(.large)
                case .shown(let response):
                    shared(response)
                case .unavailable:
                    nothing(title: "link.gone.title", body: "link.gone.body")
                case .stopped:
                    nothing(title: "share.stopped.title", body: "share.stopped.body")
                case .failed(let failure):
                    failed(failure)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(localizer.text("common.close")) { links.close() }.disabled(adding)
                }
            }
        }
        .tint(Brand.ink)
        .environment(\.locale, localizer.language.locale)
        .interactiveDismissDisabled(adding)
        .task(id: links.presentationID) {
            errorMessage = nil
            await links.load()
        }
    }

    /// A gift keeps the sheet to itself; so does a link that shows nothing.
    private var title: String {
        switch links.phase {
        case .shown(let response): response.gift == .wrapped || response.gift == .opened ? "" : localizer.text("link.shared")
        case .stopped: ""
        case .loading, .unavailable, .failed: localizer.text("link.shared")
        }
    }

    // MARK: - The parcel

    private func shared(_ response: PublicParcelResponse) -> some View {
        let gift = response.gift
        let wrapped = gift == .wrapped
        var parcel = Parcel(shared: response.package)
        // A gift on its way tells its hidden beginning once.
        if wrapped { parcel.trackingEvents = parcel.trackingEvents.collapsingGiftRows() }
        let identity = CarrierVisualIdentity.of(parcel.displayedCarrier, language: localizer.language)
        let tint = wrapped || gift == .opened ? ExperimentalPalette.lilac : identity.ink
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if wrapped || gift == .opened {
                    GiftParcelCard(parcel: parcel, opened: gift == .opened, refreshing: refreshing) {
                        Task { await refresh() }
                    }
                } else {
                    SharedParcelCard(parcel: parcel, name: links.route?.name, numberHint: response.package.numberHint,
                                     gift: gift == .own, refreshing: refreshing) {
                        Task { await refresh() }
                    }
                }
                if let failure = links.refreshFailure {
                    note(localizer.text(failure.messageKey))
                }
                if wrapped {
                    GiftSurprise()
                } else if gift == .opened {
                    // What the link carried all along comes out with the delivery.
                    GiftNote(note: links.route?.note, from: links.route?.from, inside: links.route?.name)
                }
                // A gift cannot be kept before it is delivered: that would show its number.
                if response.link.canKeep, !wrapped { keeping }
                VStack(alignment: .leading, spacing: 20) {
                    // The number and the carrier's own page would tell where a gift comes from.
                    if !wrapped {
                        SharedParcelNumber(parcel: parcel, hint: response.package.numberHint, tint: tint)
                    }
                    if CarrierCatalog.shared.tracksAutomatically(parcel.activeTrackingCarrier) || parcel.hasCarrierUpdate {
                        ParcelJournal(parcel: parcel, tint: tint)
                    }
                }
                .padding(.horizontal, 6)
                .padding(.top, 6)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        // SwiftUI cancels a refreshable's own task while the sheet redraws; the read gets its own.
        .refreshable { await Task { await refresh() }.value }
    }

    /// What a link that may be kept offers: one tap for someone signed in, sign-in for anyone else.
    @ViewBuilder private var keeping: some View {
        if signedIn {
            if case .already(let parcelID) = links.claim {
                alreadyFollowed(parcelID)
            } else {
                VStack(spacing: 8) {
                    if links.claim == .full { note(localizer.text("linkapp.full")) }
                    if let errorMessage { note(errorMessage) }
                    primaryButton(localizer.text("link.add"), symbol: "plus", busy: adding, action: add)
                    Text(localizer.text("link.addHint"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity)
                }
            }
        } else if canSignIn {
            primaryButton(localizer.text("link.signInToAdd"), symbol: nil, busy: false, action: signIn)
        }
    }

    /// Not while the saved account is still being reopened, and not in a build with no way to sign in.
    private var canSignIn: Bool {
        if case .loading = session.state { return false }
        return session.configuration.authenticationConfigured
    }

    private var signedIn: Bool {
        #if DEBUG
        if links.previewsSignedIn { return true }
        #endif
        return session.user != nil
    }

    private func primaryButton(_ title: String, symbol: String?, busy: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 9) {
                if busy {
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
        .disabled(busy)
    }

    private func alreadyFollowed(_ parcelID: UUID?) -> some View {
        let name = parcelID.flatMap { id in parcels.parcels.first { $0.id == id } }?.label.nonEmpty
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.body)
                    .foregroundStyle(ExperimentalPalette.delivered)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(localizer.text("link.already.title")).font(.subheadline.weight(.semibold))
                    if let name {
                        Text(localizer.text("link.already.body", ["name": name]))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .combine)
            }
            if let parcelID {
                Button {
                    DeliveryAnalytics.shared.action("parcel-link-open-existing")
                    links.openExisting(parcelID)
                } label: {
                    HStack(spacing: 6) {
                        Text(localizer.text("link.open"))
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).accessibilityHidden(true)
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Brand.onAccent)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Brand.accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(TactileButtonStyle())
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func note(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle").accessibilityHidden(true)
            Text(text).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.footnote)
        .foregroundStyle(Brand.warning)
        .padding(12)
        .background(Brand.warningSoft.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: - No parcel

    /// A link that shows no parcel: forgotten or unknown alike, or one whose owner stopped sharing it.
    private func nothing(title: String, body: String) -> some View {
        VStack(spacing: 12) {
            SmallPip()
                .frame(width: 120)
                .saturation(0.3)
                .opacity(0.8)
                .padding(.bottom, 8)
            Text(localizer.text(title))
                .font(.title2.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            Text(localizer.text(body))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button(localizer.text("common.close")) { links.close() }
                .buttonStyle(.borderedProminent)
                .tint(Brand.accent)
                .foregroundStyle(Brand.onAccent)
                .padding(.top, 8)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 32)
        .frame(maxWidth: 480)
    }

    private func failed(_ failure: ParcelLinkFailure) -> some View {
        VStack(spacing: 12) {
            Image(systemName: failure == .offline ? "wifi.exclamationmark" : "exclamationmark.circle")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(localizer.text(failure.messageKey))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button(localizer.text("app.tryAgain")) {
                Task { await refresh() }
            }
            .buttonStyle(.borderedProminent)
            .tint(Brand.accent)
            .foregroundStyle(Brand.onAccent)
            .disabled(refreshing)
            .padding(.top, 8)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 32)
        .frame(maxWidth: 480)
    }

    // MARK: - Actions

    private func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        await links.load()
        refreshing = false
    }

    private func add() {
        guard !adding, let link = links.route else { return }
        adding = true
        errorMessage = nil
        Task {
            do {
                let claim = try await parcels.keep(link)
                // The person may have closed this link, or opened another, while it was kept.
                if links.route == link { links.resolve(claim) }
            } catch is CancellationError {
            } catch {
                errorMessage = localizer.errorMessage(error)
            }
            adding = false
        }
    }

    private func signIn() {
        DeliveryAnalytics.shared.action("parcel-link-sign-in")
        links.rememberForSignIn()
        if session.user == nil { session.showSignIn() }
    }
}

/// The shared parcel's card: what is happening first, since a shared parcel rarely has a name.
private struct SharedParcelCard: View {
    let parcel: Parcel
    let name: String?
    /// What stands for the number when the link hides it.
    var numberHint: ParcelNumberHint? = nil
    /// The parcel is a gift, seen by its sender: the usual card, marked.
    var gift = false
    let refreshing: Bool
    let onRefresh: () -> Void

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @ObservedObject private var catalog = CarrierCatalog.shared
    @State private var atlas: WorldAtlas?
    @State private var showingMap = false
    /// How far the box of a parcel that arrived has opened: it is seen closed first, so the opening is seen.
    @State private var open = 0.0

    private var identity: CarrierVisualIdentity {
        CarrierVisualIdentity.of(parcel.displayedCarrier, catalog: catalog, language: localizer.language)
    }
    /// Scans with places are drawn as a route across the top of the card, as on the parcel's own page.
    private var placed: Bool { parcel.trackingEvents.contains { $0.place != nil } }
    /// Without a route, a parcel that arrived shows its open box above the words, as its page does.
    private var arrived: Bool { !placed && parcel.currentStage == .delivered && !typeSize.isAccessibilitySize }
    /// The label on the kraft parcel's side, with the number as the link shows it. A number no carrier knows has none.
    private var label: PipLabel? {
        guard parcel.carrier != .unknown || parcel.hasCarrierUpdate else { return nil }
        return PipLabel(identity: identity, number: numberHint?.masked ?? CarrierCatalog.format(parcel.trackingNumber, carrier: parcel.carrier))
    }

    var body: some View {
        let identity = identity
        let route = placed ? atlas.map { ParcelRoute(parcel: parcel, atlas: $0, language: localizer.language) } : nil
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 4) {
                CarrierFleetMark(identity: identity).layoutPriority(1)
                Spacer(minLength: 8)
                LinkRefreshButton(parcel: parcel, refreshing: refreshing, tint: identity.ink, action: onRefresh)
                if placed {
                    Button { showingMap = true } label: {
                        Image(systemName: "globe")
                            .font(.system(size: 17))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(identity.ink.opacity(0.75))
                    .disabled(route == nil)
                    .accessibilityLabel(localizer.text("map.open"))
                }
            }
            .frame(minHeight: 44)
            if placed {
                // Room for the route engraved behind this part of the card.
                Color.clear.frame(height: 68).allowsHitTesting(false)
            }
            if arrived {
                UnwrappingParcel(open: open, celebrating: open > 0, label: label)
                    .frame(width: 230, height: 230 * PipGeometry.frame.height / PipGeometry.frame.width)
                    .padding(.top, -34)
                    .padding(.bottom, -22)
                    .frame(maxWidth: .infinity)
            }
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: arrived ? .center : .leading, spacing: 6) {
                    if gift {
                        Label(localizer.text("share.gift.marker"), systemImage: "gift")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(ExperimentalPalette.lilac)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Brand.paper.opacity(0.72), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    if let name {
                        Text(name).font(.subheadline.weight(.medium))
                    }
                    Text(localizer.parcelStatus(parcel))
                        .font((arrived ? Font.largeTitle : .title).weight(.semibold))
                        .accessibilityAddTraits(.isHeader)
                    if let detail {
                        Text(detail)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(identity.ink)
                    }
                    if let sender = parcel.carrierData?.senderName?.nonEmpty {
                        Text(localizer.text("parcel.sender", ["sender": sender]))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .multilineTextAlignment(arrived ? .center : .leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: arrived ? .center : .leading)
                // Without a route to draw, the kraft parcel keeps the card company, its carrier's label on its side.
                if !placed, !arrived, !typeSize.isAccessibilitySize {
                    SmallPip(label: label).frame(width: 84)
                }
            }
            ExperimentalJourneyRail(stage: parcel.currentStage, tint: identity.ink.opacity(0.45), compact: true)
        }
        .padding(18)
        .background(alignment: .top) {
            if let atlas, let route {
                // The status is written over the bottom of the map, so Pip stays above it.
                RouteEngraving(atlas: atlas, route: route, stage: parcel.currentStage, identity: identity, floor: 160)
                    .frame(height: 176)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24, style: .continuous))
                    .contentShape(Rectangle())
                    .onTapGesture { showingMap = true }
                    .transition(.opacity)
            }
        }
        .background(identity.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityElement(children: .contain)
        .task(id: placed) {
            guard placed, atlas == nil else { return }
            let loaded = await WorldAtlas.bundled.value
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.5)) { atlas = loaded }
        }
        .onChange(of: arrived, initial: true) { _, arrived in
            guard arrived else { open = 0; return }
            withAnimation(reduceMotion ? nil : .spring(duration: 0.9, bounce: 0.2).delay(0.25)) { open = 1 }
        }
        .fullScreenCover(isPresented: $showingMap) {
            if let atlas {
                ParcelMapScreen(
                    atlas: atlas, route: ParcelRoute(parcel: parcel, atlas: atlas, language: localizer.language),
                    stage: parcel.currentStage, accent: identity.ink
                )
                .environmentObject(localizer)
            }
        }
        .onChange(of: showingMap) { _, open in
            if open { DeliveryAnalytics.shared.action("parcel-map-open") }
        }
    }

    private var detail: String? { localizer.sharedParcelDetail(parcel) }
}

extension Localizer {
    /// Where a shared parcel waits and when it is expected, or the day it arrived. It is a line of its own, so it starts with a capital.
    func sharedParcelDetail(_ parcel: Parcel) -> String? {
        let line = [parcel.pickupPlace, parcelCompletionDate(parcel) ?? parcelDeliveryEstimate(parcel)]
            .compactMap { $0 }.joined(separator: " · ")
        return (line.prefix(1).uppercased(with: language.locale) + line.dropFirst()).nonEmpty
    }

    /// "Arrives today, 13:00–17:00" while a gift is on its way; "Delivered today at 14:12" once it is there.
    func giftDetail(_ parcel: Parcel, opened: Bool) -> String? {
        if opened {
            guard let event = parcel.currentEvent, event.stage == .delivered, let date = DateParser.date(event.occurredAt) else { return nil }
            return text("share.gift.delivered", ["date": deliveryDate(date), "time": clockTime(date)])
        }
        return parcelDeliveryEstimate(parcel).map { text("share.gift.arrives", ["date": $0]) }
    }
}

/// When the carrier was last asked; a tap reads the link again. In a narrow card or at large
/// type, the arrow alone stays.
private struct LinkRefreshButton: View {
    let parcel: Parcel
    let refreshing: Bool
    let tint: Color
    let action: () -> Void

    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        ViewThatFits(in: .horizontal) {
            button(dated: true)
            button(dated: false)
        }
    }

    private func button(dated: Bool) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if dated, let checked = parcel.lastSyncedAt {
                    // The age is written out, so it is kept current while the sheet stays open.
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        Text(localizer.text("parcel.updated", ["date": localizer.relativeTime(from: checked, now: context.date)]))
                    }
                }
                Group {
                    if refreshing { ProgressView().controlSize(.mini) }
                    else { Image(systemName: "arrow.clockwise").font(.caption2.weight(.medium)) }
                }
                .frame(width: 16, height: 16)
            }
            .font(.caption)
            .lineLimit(1)
            .fixedSize()
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(tint.opacity(0.75))
        .disabled(refreshing)
        .accessibilityLabel(localizer.text("detail.checkNow"))
        .accessibilityValue(parcel.lastSyncedAt.map {
            localizer.text("parcel.updated", ["date": localizer.relativeTime(from: $0)])
        } ?? "")
    }
}

/// A gift as its recipient sees it: wrapped while it is on its way, with nothing about who
/// sent it or what it is, and the open box once it is delivered.
private struct GiftParcelCard: View {
    let parcel: Parcel
    let opened: Bool
    let refreshing: Bool
    let onRefresh: () -> Void

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @ObservedObject private var catalog = CarrierCatalog.shared
    /// How far the box has opened: it is seen closed first, so the opening is seen.
    @State private var open = 0.0

    var body: some View {
        let identity = CarrierVisualIdentity.of(parcel.displayedCarrier, catalog: catalog, language: localizer.language)
        let tone = ExperimentalPalette.lilac
        let width: CGFloat = typeSize.isAccessibilitySize ? 150 : opened ? 250 : 220
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                CarrierFleetMark(identity: identity).layoutPriority(1)
                Spacer(minLength: 8)
                LinkRefreshButton(parcel: parcel, refreshing: refreshing, tint: tone, action: onRefresh)
            }
            .frame(minHeight: 44)
            UnwrappingParcel(open: opened ? open : 0, celebrating: opened && open > 0, ribbon: true)
                .frame(width: width, height: width * PipGeometry.frame.height / PipGeometry.frame.width)
                .padding(.top, opened ? -6 : -16)
                .padding(.bottom, opened ? -8 : -6)
            VStack(spacing: 7) {
                Text(localizer.text(opened ? "share.gift.here" : "share.gift.headline"))
                    .font((opened ? Font.largeTitle : .title).weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                if let detail {
                    Text(detail)
                        .font(.callout.weight(.medium))
                        .foregroundStyle(tone)
                }
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            if !opened {
                ExperimentalJourneyRail(stage: parcel.currentStage, tint: tone.opacity(0.55), compact: true)
                    .padding(.top, 18)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 20)
        .background(ExperimentalPalette.lilacSurface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityElement(children: .contain)
        .onChange(of: opened, initial: true) { _, opened in
            guard opened else { open = 0; return }
            withAnimation(reduceMotion ? nil : .spring(duration: 0.9, bounce: 0.2).delay(0.25)) { open = 1 }
        }
    }

    private var detail: String? { localizer.giftDetail(parcel, opened: opened) }
}

/// Under a gift on its way: why the sheet says so little.
private struct GiftSurprise: View {
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "gift").accessibilityHidden(true)
            Text(localizer.text("share.gift.surprise")).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6)
    }
}

/// What a gift's link carried all along and shows once the parcel is delivered: the sender's
/// note, who it is from, and what is inside. None of it ever reached the service.
private struct GiftNote: View {
    let note: String?
    let from: String?
    let inside: String?

    @EnvironmentObject private var localizer: Localizer

    private static let paper = Brand.color(light: "#FFFDF7", dark: "#2C2A24")
    private static let edge = Brand.color(light: "#EBE5D6", dark: "#45413A")
    private static let fold = Brand.color(light: "#D8CFB8", dark: "#55503F")
    private static let ink = Brand.color(light: "#3B3A33", dark: "#ECE7DA")
    private static let signature = Brand.color(light: "#6B675A", dark: "#B9B3A4")

    var body: some View {
        if note != nil || from != nil || inside != nil {
            VStack(alignment: .leading, spacing: 0) {
                if let note {
                    Text(note)
                        .font(.system(.title3, design: .serif).weight(.semibold).italic())
                        .foregroundStyle(Self.ink)
                        .lineSpacing(4)
                }
                if let from {
                    Text("— " + from)
                        .font(.system(.body, design: .serif).weight(.semibold).italic())
                        .foregroundStyle(Self.signature)
                        .padding(.top, note == nil ? 0 : 10)
                }
                if let inside {
                    if note != nil || from != nil {
                        Line()
                            .stroke(Self.fold, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                            .frame(height: 1)
                            .padding(.top, 16)
                            .padding(.bottom, 12)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "gift").foregroundStyle(.secondary).accessibilityHidden(true)
                        (Text(localizer.text("share.gift.inside") + " ").foregroundStyle(.secondary)
                            + Text(inside).fontWeight(.semibold))
                    }
                    .font(.footnote)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(Self.paper, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Self.edge))
            .rotationEffect(.degrees(-0.8))
            .accessibilityElement(children: .combine)
        }
    }

    private struct Line: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            path.move(to: CGPoint(x: rect.minX, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            return path
        }
    }
}

/// The tracking number as the link shows it: whole, to copy and look up, or with its middle hidden.
private struct SharedParcelNumber: View {
    let parcel: Parcel
    let hint: ParcelNumberHint?
    let tint: Color

    @EnvironmentObject private var localizer: Localizer
    @ObservedObject private var catalog = CarrierCatalog.shared
    @State private var copiedNumber: String?

    var body: some View {
        if let hint {
            // A hidden number cannot be copied or looked up.
            row(title: localizer.text("detail.trackingNumber"), number: hint.masked)
                .accessibilityElement(children: .combine)
        } else if !parcel.trackingNumber.isEmpty {
            let numbers = parcel.trackingNumbers
            VStack(alignment: .leading, spacing: 0) {
                ForEach(numbers, id: \.number) { entry in
                    HStack(alignment: .center, spacing: 8) {
                        row(title: numbers.count > 1
                                ? catalog.info(for: entry.carrier, language: localizer.language).displayName
                                : localizer.text("detail.trackingNumber"),
                            number: CarrierCatalog.format(entry.number, carrier: entry.carrier))
                            .textSelection(.enabled)
                        Spacer(minLength: 0)
                        Button { copy(entry.number, carrier: entry.carrier) } label: {
                            Image(systemName: copiedNumber == entry.number ? "checkmark" : "doc.on.doc")
                                .font(.system(size: 14, weight: .regular))
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).foregroundStyle(.secondary)
                        .accessibilityLabel(localizer.text(copiedNumber == entry.number ? "detail.copied" : "detail.copyTracking")
                            + (numbers.count > 1 ? " — " + catalog.info(for: entry.carrier, language: localizer.language).displayName : ""))
                    }
                }
                ForEach(catalog.trackingLinks(for: parcel, language: localizer.language)) { link in
                    Link(destination: link.url) {
                        HStack(spacing: 6) {
                            Text(localizer.text("detail.carrierWebsite", ["carrier": link.name]))
                            Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .regular))
                                .accessibilityHidden(true)
                        }
                        .font(.caption)
                        .frame(minHeight: 44, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(tint)
                    .simultaneousGesture(TapGesture().onEnded { DeliveryAnalytics.shared.action("parcel-carrier-link") })
                }
            }
        }
    }

    private func row(title: String, number: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(number)
                .font(.system(.caption, design: .monospaced))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func copy(_ value: String, carrier: CarrierID) {
        DeliveryAnalytics.shared.action("parcel-copy-tracking")
        UIPasteboard.general.string = carrier == .postlogistics ? CarrierCatalog.format(value, carrier: carrier) : value
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        copiedNumber = value
        Task {
            try? await Task.sleep(for: .seconds(2))
            if copiedNumber == value { copiedNumber = nil }
        }
    }
}

/// Shows a sheet over whatever is frontmost, so a sheet or screen that was open stays as it
/// was underneath. A SwiftUI sheet on the root view would close it first.
struct FrontmostSheet<Content: View>: UIViewControllerRepresentable {
    let isPresented: Bool
    /// The person swiped the sheet away.
    let onClose: () -> Void
    /// The sheet has left the screen, whoever closed it.
    let onDismiss: () -> Void
    @ViewBuilder let content: () -> Content

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> Anchor {
        let anchor = Anchor()
        anchor.view.isUserInteractionEnabled = false
        // The first update can come before the anchor has a window to present in.
        anchor.onAppear = { [weak coordinator = context.coordinator] in coordinator?.sync() }
        context.coordinator.anchor = anchor
        return anchor
    }

    func updateUIViewController(_ anchor: Anchor, context: Context) {
        let coordinator = context.coordinator
        coordinator.wanted = isPresented
        coordinator.onClose = onClose
        coordinator.onDismiss = onDismiss
        coordinator.content = { AnyView(content()) }
        coordinator.sync()
    }

    final class Anchor: UIViewController {
        var onAppear: (() -> Void)?

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            onAppear?()
        }
    }

    private final class Host: UIHostingController<AnyView> {
        var onGone: (() -> Void)?

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            if isBeingDismissed { gone() } else {
                // A screen underneath may have closed and taken this sheet with it.
                DispatchQueue.main.async { [weak self] in
                    if let self, self.presentingViewController == nil { self.gone() }
                }
            }
        }

        private func gone() {
            let report = onGone
            onGone = nil
            report?()
        }
    }

    @MainActor
    final class Coordinator {
        weak var anchor: Anchor?
        var wanted = false
        var onClose: () -> Void = {}
        var onDismiss: () -> Void = {}
        var content: () -> AnyView = { AnyView(EmptyView()) }
        private var sheet: UIViewController?
        private var dismissing = false
        private var retry: Task<Void, Never>?

        func sync() {
            if let sheet {
                guard !wanted, !dismissing else { return }
                dismissing = true
                // Asking the presenter closes the sheet along with anything it opened.
                (sheet.presentingViewController ?? sheet).dismiss(animated: true)
            } else if wanted, retry == nil {
                present()
            }
        }

        private func present() {
            guard let root = anchor?.view.window?.rootViewController else { return }
            var top = root
            while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
            // An alert, or a screen still arriving or leaving, cannot present anything yet.
            guard !(top is UIAlertController), top.transitionCoordinator == nil,
                  !top.isBeingPresented, !top.isBeingDismissed else {
                retry = Task { [weak self] in
                    try? await Task.sleep(for: .milliseconds(350))
                    self?.retry = nil
                    self?.sync()
                }
                return
            }
            let host = Host(rootView: content())
            host.onGone = { [weak self] in self?.gone() }
            sheet = host
            dismissing = false
            top.present(host, animated: true)
        }

        private func gone() {
            let closedByPerson = !dismissing
            sheet = nil
            dismissing = false
            if closedByPerson {
                wanted = false
                onClose()
            }
            onDismiss()
            // A link opened while the sheet was leaving gets a sheet of its own.
            Task { [weak self] in self?.sync() }
        }
    }
}
