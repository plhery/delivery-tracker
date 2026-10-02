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
                    gone
                case .failed(let failure):
                    failed(failure)
                }
            }
            .navigationTitle(localizer.text("link.shared"))
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

    // MARK: - The parcel

    private func shared(_ response: PublicParcelResponse) -> some View {
        let parcel = Parcel(shared: response.package)
        let identity = CarrierVisualIdentity.of(parcel.displayedCarrier, language: localizer.language)
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                SharedParcelCard(parcel: parcel, name: links.route?.name, refreshing: refreshing) {
                    Task { await refresh() }
                }
                if let failure = links.refreshFailure {
                    note(localizer.text(failure.messageKey))
                }
                if response.link.canKeep { keeping }
                VStack(alignment: .leading, spacing: 20) {
                    SharedParcelNumber(parcel: parcel, hint: response.package.numberHint, tint: identity.ink)
                    if CarrierCatalog.shared.tracksAutomatically(parcel.activeTrackingCarrier) || parcel.hasCarrierUpdate {
                        ParcelJournal(parcel: parcel, tint: identity.ink)
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
                Button { links.openExisting(parcelID) } label: {
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

    private var gone: some View {
        VStack(spacing: 12) {
            SmallPip()
                .frame(width: 120)
                .saturation(0.3)
                .opacity(0.8)
                .padding(.bottom, 8)
            Text(localizer.text("link.gone.title"))
                .font(.title2.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            Text(localizer.text("link.gone.body"))
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
        links.rememberForSignIn()
        if session.user == nil { session.showSignIn() }
    }
}

/// The shared parcel's card: what is happening first, since a shared parcel rarely has a name.
private struct SharedParcelCard: View {
    let parcel: Parcel
    let name: String?
    let refreshing: Bool
    let onRefresh: () -> Void

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @ObservedObject private var catalog = CarrierCatalog.shared
    @State private var atlas: WorldAtlas?
    @State private var showingMap = false

    private var identity: CarrierVisualIdentity {
        CarrierVisualIdentity.of(parcel.displayedCarrier, catalog: catalog, language: localizer.language)
    }
    /// Scans with places are drawn as a route across the top of the card, as on the parcel's own page.
    private var placed: Bool { parcel.trackingEvents.contains { $0.place != nil } }

    var body: some View {
        let identity = identity
        let route = placed ? atlas.map { ParcelRoute(parcel: parcel, atlas: $0, language: localizer.language) } : nil
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 4) {
                CarrierFleetMark(identity: identity).layoutPriority(1)
                Spacer(minLength: 8)
                // In a narrow card or at large type, the arrow alone stays.
                ViewThatFits(in: .horizontal) {
                    refreshButton(tint: identity.ink, dated: true)
                    refreshButton(tint: identity.ink, dated: false)
                }
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
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    if let name {
                        Text(name).font(.subheadline.weight(.medium))
                    }
                    Text(localizer.parcelStatus(parcel))
                        .font(.title.weight(.semibold))
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
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                // Without a route to draw, the kraft parcel keeps the card company.
                if !placed, !typeSize.isAccessibilitySize {
                    SmallPip().frame(width: 84)
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

    /// Where it waits and when it is expected, or the day it arrived. It is a line of its own, so it starts with a capital.
    private var detail: String? {
        let line = [parcel.pickupPlace, localizer.parcelCompletionDate(parcel) ?? localizer.parcelDeliveryEstimate(parcel)]
            .compactMap { $0 }.joined(separator: " · ")
        return (line.prefix(1).uppercased(with: localizer.language.locale) + line.dropFirst()).nonEmpty
    }

    /// When the carrier was last asked; a tap reads the link again.
    private func refreshButton(tint: Color, dated: Bool) -> some View {
        Button(action: onRefresh) {
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
