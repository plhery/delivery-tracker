import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

struct ParcelListView: View {
    @EnvironmentObject private var localizer: Localizer
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var store: ParcelStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var selection: Int
    @State private var firstParcel: FirstParcelRequest?
    @State private var adding = false
    /// Nobody is signed in and this iPhone follows nothing: the first screen stands over the deliveries.
    @State private var showsFirstOpen = false

    var body: some View {
        TabView(selection: $selection) {
            DeliveryListView(isSelected: selection == 0, firstParcel: $firstParcel, adding: $adding)
                .tag(0)
                .tabItem {
                    Label(localizer.text("native.deliveries"), systemImage: "shippingbox.fill")
                }

            PassportView()
                .tag(1)
                .tabItem {
                    Label(ExperimentalCopy(localizer: localizer).passport, systemImage: "book.closed.fill")
                }

            Group {
                if session.isGuest { FriendsSignedOutView() } else { FriendsView() }
            }
                .tag(2)
                .tabItem { Label(localizer.text("friends.title"), systemImage: "person.2.fill") }
        }
        .tint(Brand.ink)
        .accessibilityHidden(showsFirstOpen)
        .overlay {
            if showsFirstOpen {
                FirstOpenView(covered: adding) { firstParcel = $0 }
                    // It lifts away, and the deliveries under it show the parcel that just came in.
                    .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .top).combined(with: .opacity)))
            }
        }
        .onChange(of: FirstOpenPresence(guest: session.isGuest, empty: store.parcels.isEmpty, adding: adding), initial: true) { before, now in
            // It comes back when the last parcel is forgotten, at once on a launch. It leaves when the
            // first parcel is in, once the sheet that added it has closed: the list is then seen receiving it.
            let shows = now.guest && (now.empty || (now.adding && showsFirstOpen))
            guard shows != showsFirstOpen else { return }
            if before == now { showsFirstOpen = shows } else { withAnimation(reduceMotion ? nil : .smooth(duration: 0.55)) { showsFirstOpen = shows } }
        }
        .sensoryFeedback(.selection, trigger: selection)
        .onChange(of: selection) { _, tab in
            DeliveryAnalytics.shared.view(tab == 1 ? "passport" : tab == 2 ? "friends" : "deliveries")
        }
    }
}

/// What decides whether the first screen stands over the deliveries.
private struct FirstOpenPresence: Equatable {
    let guest: Bool
    let empty: Bool
    let adding: Bool
}

struct DemoModeBar: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        if session.isDemo {
            Button {
                session.showWelcome()
            } label: {
                HStack(spacing: 12) {
                    Text(localizer.text("app.demo"))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Text(localizer.text("native.exitDemo"))
                        .font(.subheadline.weight(.semibold))
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .symbolRenderingMode(.hierarchical)
                }
                .foregroundStyle(Brand.ink)
                .padding(.horizontal, 20)
                .padding(.vertical, 6)
                .frame(minHeight: 48)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(TactileButtonStyle(scale: 0.995))
            .background(Brand.cream)
            .overlay(alignment: .bottom) { Divider().opacity(0.45) }
            .accessibilityLabel("\(localizer.text("app.demo")), \(localizer.text("native.exitDemo"))")
            .accessibilityIdentifier("demo.exit")
        }
    }
}

/// The foot of the deliveries: the name, then the site's landing, its privacy notice and
/// the code. Each opens as a page of the site, read without leaving the app.
struct DeliveriesFoot: View {
    let configuration: AppConfiguration
    let open: (URL) -> Void

    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                PeekMark(size: 18)
                Text(verbatim: "\(localizer.text("app.title")) · \(localizer.text("app.tagline"))")
                    .multilineTextAlignment(.center)
            }
            .frame(minHeight: 44)
            .accessibilityElement(children: .combine)
            // Side by side where they fit, one under the other in a large text size.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 22) { links }
                VStack(spacing: 0) { links }
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("deliveries.foot")
    }

    @ViewBuilder private var links: some View {
        link(localizer.text("app.homePage"), to: configuration.homePageURL, id: "home")
        link(localizer.text("auth.privacyLink"), to: configuration.privacyURL, id: "privacy")
        link("GitHub", to: AppConfiguration.sourceURL, id: "source")
    }

    /// A quiet link with a full-height touch target.
    private func link(_ title: String, to url: URL, id: String) -> some View {
        Button { open(url) } label: {
            Text(verbatim: title)
                .underline(color: Color(uiColor: .tertiaryLabel))
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .accessibilityIdentifier("deliveries.foot.\(id)")
    }
}

private struct DeliveryListView: View {
    let isSelected: Bool
    /// What the first screen asked for; this list owns the sheet that adds a parcel.
    @Binding var firstParcel: FirstParcelRequest?
    @Binding var adding: Bool
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var localizer: Localizer
    @EnvironmentObject private var links: ParcelLinkStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @Environment(\.scenePhase) private var scenePhase

    @Namespace private var parcelTransition
    @State private var path: [UUID] = []
    @State private var query = ""
    @State private var statusFilter: ParcelStatusFilter = .all
    @State private var carrierFilter: CarrierID?
    @State private var sort: ParcelSort = .priority
    @State private var showingFilters = false
    @State private var showingSearch = false
    @FocusState private var searchFocused: Bool
    @State private var showingAdd = false
    @State private var addedParcelID: UUID?
    @State private var revealParcelID: UUID?
    @State private var parcelBurstID: UUID?
    @State private var showingAccount = false
    @State private var sitePage: SitePage?
    @State private var archivedExpanded = false
    @State private var sharedDraft: SharedParcelDraft?
    @State private var scanning = false
    @State private var toast: ListToast?
    @State private var actionError: String?
    @State private var pull = PullToRefreshModel()
    /// Parcels delivered since the list was last shown, held in place until their cards leave.
    @State private var delivered = DeliveredHold()
    @State private var places = DeliveryCardPlaces()
    @State private var flights: [DeliveredFlight] = []
    @State private var flightProgress: CGFloat = 0
    @State private var flightRound = 0
    @State private var postmarks = 0
    @State private var paper: DeliveredPaperBurst?

    @ObservedObject private var catalog = CarrierCatalog.shared

    private struct ListToast: Equatable {
        let text: String
        var warning = false
    }

    var body: some View {
        // Filtering, sorting and grouping run once per render, not once per section.
        let layout = arrangement(of: delivered.arranged(store.parcels))
        // The cards that are others once the held parcels are let go: those leave without a trace, and are flown.
        let leaving = delivered.isEmpty ? [] : Set(layout.changing(into: arrangement(of: store.parcels)).keys)
        return holdingDelivered(screen(layout, leaving: leaving))
    }

    /// A parcel delivered since the list was last shown keeps its place for a moment, then its card leaves.
    /// Kept apart from the screen's own modifiers, which are as many as the compiler takes in one expression.
    private func holdingDelivered(_ screen: some View) -> some View {
        screen
            .sensoryFeedback(.success, trigger: postmarks)
            // The store announces its next list before it shows it: what was shown is still at hand.
            .onReceive(store.$parcels) { next in
                delivered.receive(shown: store.parcels, next: next, watching: watching)
            }
            .onChange(of: watching) { _, watching in if !watching { delivered.release() } }
            .task(id: delivered.ids) {
                guard !delivered.isEmpty else { return }
                do {
                    // The postmark lands, then the card has a moment to be read before it leaves.
                    try await Task.sleep(for: .milliseconds(300))
                    postmarks += 1
                    throwPaper()
                    try await Task.sleep(for: .milliseconds(650))
                } catch { return }
                letGo()
            }
            .overlay { DeliveredPaper(burst: paper) }
    }

    /// Paper for the parcels that have just arrived: one burst however many they are, out of Pip's open box
    /// on the first of their cards that shows, in that card's colours.
    private func throwPaper() {
        let layout = arrangement(of: delivered.arranged(store.parcels))
        // From the top of the list down: the large card first.
        var cards: [(parcel: Parcel, top: CGFloat)] = []
        for parcel in store.parcels where delivered.holds(parcel.id) {
            if let place = places.place(of: parcel.id) { cards.append((parcel, place.frame.minY)) }
        }
        cards.sort { $0.top < $1.top }
        for (parcel, _) in cards {
            guard let mouth = places.mouth(of: parcel.id) else { continue }
            let identity = CarrierVisualIdentity.of(parcel.displayedCarrier, catalog: catalog, language: localizer.language)
            let count = layout.kind(of: parcel.id) == .next ? DeliveredConfetti.next : DeliveredConfetti.other
            let confetti = DeliveredConfetti(origin: mouth, count: count, seed: UInt64.random(in: 0...UInt64.max))
            let colors = DeliveredPaperBurst.colors(ink: identity.ink, surface: identity.surface, brand: identity.brand)
            let burst = DeliveredPaperBurst(confetti: confetti, colors: colors, started: Date.now)
            paper = burst
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(burst.confetti.duration))
                if paper == burst { paper = nil }
            }
            return
        }
    }

    private func screen(_ layout: DeliveryListLayout, leaving: Set<UUID>) -> some View {
        NavigationStack(path: $path) {
            ZStack {
                ExperimentalBackdrop()
                content(layout, leaving: leaving)
            }
            .safeAreaInset(edge: .top, spacing: 0) { DemoModeBar() }
            .navigationTitle(localizer.text("native.deliveries"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .navigationDestination(for: UUID.self) { parcelID in
                ParcelDetailView(parcelID: parcelID, transition: parcelTransition)
                    .safeAreaInset(edge: .top, spacing: 0) { DemoModeBar() }
            }
            .safeAreaInset(edge: .bottom, spacing: 8) { bottomControls }
        }
        .task(id: query) {
            guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            do { try await Task.sleep(for: .milliseconds(800)) } catch { return }
            DeliveryAnalytics.shared.action("search")
        }
        .onChange(of: statusFilter) { _, _ in DeliveryAnalytics.shared.action("filter-status") }
        .onChange(of: carrierFilter) { _, _ in DeliveryAnalytics.shared.action("filter-carrier") }
        .onChange(of: sort) { _, _ in DeliveryAnalytics.shared.action("sort-change") }
        .onChange(of: archivedExpanded) { _, open in if open { DeliveryAnalytics.shared.action("archive-open") } }
        .sensoryFeedback(.success, trigger: parcelBurstID) { _, next in next != nil }
        .fullScreenCover(isPresented: $showingAdd, onDismiss: {
            scanning = false
            if let id = addedParcelID, scenePhase == .active {
                if !visibleParcels.contains(where: { $0.id == id }) { clearFilters() }
                revealParcelID = id
            }
            addedParcelID = nil
        }) {
            AddParcelView(draft: sharedDraft, scanning: scanning, onOpenParcel: { parcelID in
                showingAdd = false
                path = [parcelID]
            }, onAdded: { id in
                if showingAdd && scenePhase == .active { addedParcelID = id }
            })
                .environmentObject(store)
                .environmentObject(localizer)
        }
        .onChange(of: showingAdd) { _, showing in adding = showing }
        .onChange(of: firstParcel) { _, request in
            guard let request else { return }
            firstParcel = nil
            add(request)
        }
        .sheet(isPresented: $showingFilters) {
            ParcelFilterView(
                status: $statusFilter,
                carrier: $carrierFilter,
                sort: $sort,
                carriers: availableCarriers
            )
            .environmentObject(localizer)
        }
        .sheet(isPresented: $showingAccount) {
            AccountView()
                .environmentObject(store)
                .environmentObject(session)
                .environmentObject(localizer)
        }
        .sheet(item: $sitePage) { SafariPage(url: $0.url).ignoresSafeArea() }
        .alert(localizer.text("native.errorTitle"), isPresented: Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )) {
            Button(localizer.text("common.close"), role: .cancel) { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
        .onAppear {
            consumeSharedDraft()
            consumePendingParcelNotification()
        }
        .onDisappear { addedParcelID = nil; revealParcelID = nil; parcelBurstID = nil; flights = [] }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { addedParcelID = nil; revealParcelID = nil; parcelBurstID = nil }
        }
        .onChange(of: path) { _, value in DeliveryAnalytics.shared.view(value.isEmpty ? "deliveries" : "parcel"); revealParcelID = nil; parcelBurstID = nil }
        .onChange(of: showingAdd) { _, open in DeliveryAnalytics.shared.view(open ? "add-parcel" : "deliveries"); if open { revealParcelID = nil; parcelBurstID = nil } }
        .onChange(of: showingAccount) { _, open in DeliveryAnalytics.shared.view(open ? "account" : "deliveries"); if open { revealParcelID = nil; parcelBurstID = nil } }
        .onChange(of: showingFilters) { _, open in if open { DeliveryAnalytics.shared.action("filters-open"); revealParcelID = nil; parcelBurstID = nil } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            consumeSharedDraft()
        }
        .onReceive(NotificationCenter.default.publisher(for: .didOpenParcelNotification)) { notification in
            DeliveryAnalytics.shared.action("notification-open")
            openParcelNotification(AppDelegate.consumePendingParcelID() ?? (notification.object as? UUID))
        }
        .onOpenURL(perform: handleURL)
        .onChange(of: links.arrival, initial: true) { _, arrival in receive(arrival) }
        #if DEBUG
        .task {
            if let parcel = ParcelSharePreview.parcel(in: store.parcels) { path = [parcel.id] }
        }
        #endif
        .onChange(of: store.undoParcel?.id) { _, next in
            guard let next else { return }
            Task {
                try? await Task.sleep(for: .seconds(7))
                if store.undoParcel?.id == next { store.undoParcel = nil }
            }
        }
    }

    private func content(_ layout: DeliveryListLayout, leaving: Set<UUID>) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 10) {
                        if !store.parcels.isEmpty { listOverview(layout) }
                        if showingSearch { searchControls }
                        if hasCustomView { filterChips }
                        if let message = store.errorMessage {
                            NoticeBanner(
                                symbol: "wifi.exclamationmark",
                                title: localizer.text(store.authenticationRequired ? "app.signInNeeded" : "app.trackingBreak"),
                                message: store.usingCachedData ? "\(message) \(localizer.text("app.cachedData"))" : message,
                                tint: Brand.warning,
                                actionTitle: localizer.text(store.authenticationRequired ? "app.signInAgain" : "app.tryAgain"),
                                action: { Task { await store.load(showSpinner: true) } }
                            )
                        }
                        listEmptyState(layout)
                        if let nextParcel = layout.next { nextCard(nextParcel, leaving: leaving) }
                        ForEach(layout.attention) { parcel in card(parcel, flagged: true, leaving: leaving) }
                        ForEach(layout.remaining) { parcel in card(parcel, flagged: false, leaving: leaving) }
                    }
                    // Someone following parcels without an account is offered one, once and quietly.
                    if session.isGuest, !store.parcels.isEmpty, !hasCustomView { DeviceAccountRow() }
                    ForEach(layout.sections) { section in sectionContent(section, next: layout.next) }
                    // The foot ends the list once there is one: the first load shows its own message.
                    if !(store.loading && store.parcels.isEmpty) {
                        DeliveriesFoot(configuration: session.configuration) { sitePage = SitePage(url: $0) }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 28)
                .animation(reduceMotion ? nil : .snappy(duration: 0.32), value: store.parcels.filter { !$0.isArchived }.map(\.id))
                .coordinateSpace(.named(DeliveryListSpace.name))
                // A card that takes another place is flown there, over the list and moving with it.
                .overlay(alignment: .topLeading) {
                    ZStack(alignment: .topLeading) {
                        ForEach(flights) { flight in
                            DeliveredFlightCard(flight: flight, progress: flightProgress, transition: parcelTransition)
                        }
                    }
                }
                .background { DeliveryScrollProbe(places: places) }
                .background(alignment: .top) {
                    PullToRefreshIndicator(model: pull, pullLabel: localizer.text("app.pullToRefresh"))
                }
            }
            .scrollIndicators(.hidden)
            .onScrollGeometryChange(for: PullGeometry.self, of: PullGeometry.init) { _, geometry in
                pull.track(geometry)
            }
            .refreshable {
                // SwiftUI cancels this task while the list redraws for the refresh,
                // which cancelled the request and reported a connection error. The
                // pull waits for a task of its own instead.
                await Task { await refreshFromPull() }.value
            }
            .overlay {
                if store.loading && store.parcels.isEmpty {
                    VStack(spacing: 12) {
                        ProgressView().controlSize(.large)
                        Text(localizer.text("app.opening"))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .task(id: revealParcelID) {
                guard let id = revealParcelID else { return }
                await Task.yield()
                guard !Task.isCancelled, revealParcelID == id else { return }
                withAnimation(reduceMotion ? nil : .smooth(duration: 0.35)) {
                    proxy.scrollTo(id, anchor: .center)
                } completion: {
                    guard revealParcelID == id, scenePhase == .active else { return }
                    parcelBurstID = id
                    revealParcelID = nil
                }
            }
            .onScrollPhaseChange { _, phase in
                if phase == .interacting { revealParcelID = nil; parcelBurstID = nil }
            }
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            AccountToolbarButton { showingAccount = true }
        }

        // The mark stands at the leading edge on its own tile, not on a control's glass.
        if #available(iOS 26.0, *) {
            ToolbarItem(placement: .topBarLeading) { PeekMark(size: 30) }
                .sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: .topBarLeading) { PeekMark(size: 30) }
        }

        ToolbarItem(placement: .topBarLeading) {
            Button {
                sharedDraft = nil
                showingAdd = true
            } label: {
                Image(systemName: "plus")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Brand.ink)
                    .frame(width: 34, height: 34)
            }
            .accessibilityLabel(localizer.text("app.addParcelAria"))
        }
    }

    private func listOverview(_ layout: DeliveryListLayout) -> some View {
        HStack(spacing: 8) {
            if !layout.active.isEmpty {
                Text(localizer.text("app.onTheWaySection"))
                    .font(.headline.weight(.semibold))
                Text("\(layout.active.count)")
                    .contentTransition(.numericText())
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6).frame(minHeight: 20)
                    .background(.secondary.opacity(0.09), in: Capsule())
            }
            Spacer(minLength: 0)
            Button {
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.3)) { showingSearch.toggle() }
                searchFocused = showingSearch
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.body.weight(.regular))
                    .frame(width: 44, height: 44)
                    .background(showingSearch || hasCustomView ? Brand.ink.opacity(0.06) : .clear, in: Circle())
            }
            .accessibilityLabel(localizer.text(showingSearch ? "view.hideControls" : "view.showControls"))
            .accessibilityIdentifier("deliveries.search")
            // Pulling refreshes the list; VoiceOver users also get a button.
            if voiceOverEnabled {
                Button { Task { await refreshForVoiceOver() } } label: {
                    Group {
                        if store.refreshing { ProgressView() }
                        else { Image(systemName: "arrow.clockwise").font(.body.weight(.regular)) }
                    }.frame(width: 44, height: 44)
                }
                .disabled(store.refreshing)
                .accessibilityLabel(localizer.text(store.refreshing ? "app.refreshing" : "app.refresh"))
            }
        }
        .foregroundStyle(Brand.ink)
        .buttonStyle(.plain)
    }

    /// One quiet field, as the system's own search fields are: no box around it, its tools inside and beside it.
    private var searchControls: some View {
        HStack(spacing: 4) {
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
                TextField(localizer.text("view.searchPlaceholder"), text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .focused($searchFocused)
                    .onAppear { searchFocused = true }
                    .accessibilityLabel(localizer.text("view.search"))
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary).frame(width: 30, height: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel(localizer.text("view.clear"))
                    .transition(.opacity.combined(with: .scale(scale: 0.7)))
                }
            }
            .padding(.leading, 13).padding(.trailing, query.isEmpty ? 13 : 5).frame(minHeight: 44)
            .background(Brand.ink.opacity(0.06), in: Capsule())
            .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: query.isEmpty)
            Button { searchFocused = false; showingFilters = true } label: {
                Image(systemName: "line.3.horizontal.decrease").frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel(localizer.text("view.showControls"))
        }
        .font(.subheadline)
        .buttonStyle(.plain)
        .onKeyPress(.escape) {
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.3)) { showingSearch = false }
            searchFocused = false
            return .handled
        }
        .transition(.opacity.combined(with: .scale(scale: 0.94, anchor: .top)).combined(with: .offset(y: -10)))
    }

    @ViewBuilder private func listEmptyState(_ layout: DeliveryListLayout) -> some View {
        if !store.loading {
            if store.parcels.isEmpty {
                DeliveriesEmptyState(onAdd: add)
            } else if layout.visible.isEmpty {
                ContentUnavailableView {
                    Label(localizer.text("view.noResultsTitle"), systemImage: "magnifyingglass")
                } description: { Text(localizer.text("view.noResultsDescription")) }
                actions: { Button(localizer.text("view.clear")) { clearFilters() } }
                    .frame(maxWidth: .infinity).padding(.vertical, 32)
            // Someone without an account is not told to track another parcel: the row under the cards speaks to them.
            } else if !session.isGuest, !hasCustomView, store.errorMessage == nil, store.parcels.allSatisfy(\.isDelivered) {
                VStack(spacing: 12) {
                    Image(systemName: "checkmark").font(.system(size: 36, weight: .ultraLight))
                        .foregroundStyle(.secondary).padding(.bottom, 6).accessibilityHidden(true)
                    Text(localizer.text("app.allArrived")).font(.title2.weight(.semibold))
                    Text(localizer.text("app.allArrivedDescription")).font(.subheadline).foregroundStyle(.secondary)
                    Button(localizer.text("app.trackAnother")) { sharedDraft = nil; showingAdd = true }
                        .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
                        .padding(.top, 6)
                }
                .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.vertical, 32)
                .accessibilityIdentifier("deliveries.allArrived")
            }
        }
    }

    /// Holds the pull open until every parcel has been checked, then shows the
    /// result on the seal before letting go, as the web app does.
    private func refreshFromPull() async {
        pull.begin(label: localizer.text("app.refreshing"))
        let started = ContinuousClock.now
        let result = await checkAllParcels()
        // A check that answers at once still shows the arrow turning.
        try? await Task.sleep(until: started + .milliseconds(900), clock: .continuous)
        switch result {
        case .failed(let message)?:
            finishPull(succeeded: false, label: localizer.text("detail.checkFailed"))
            try? await Task.sleep(for: .milliseconds(1100))
            toast = ListToast(text: message, warning: true)
        case .stillChecking?:
            // The checks keep running, so the arrow keeps turning under the message.
            let label = localizer.text("app.refreshTimeout")
            pull.update(label: label)
            AccessibilityNotification.Announcement(label).post()
            try? await Task.sleep(for: .milliseconds(1100))
        case let result?:
            finishPull(succeeded: true, label: localizer.text(result.messageKey))
            try? await Task.sleep(for: .milliseconds(700))
        case nil:
            break
        }
        pull.settle()
    }

    private func refreshForVoiceOver() async {
        switch await checkAllParcels() {
        case .failed(let message)?:
            toast = ListToast(text: message, warning: true)
            AccessibilityNotification.Announcement(message).post()
        case let result?:
            AccessibilityNotification.Announcement(localizer.text(result.messageKey)).post()
        case nil:
            break
        }
    }

    private func finishPull(succeeded: Bool, label: String) {
        pull.finish(succeeded: succeeded, label: label)
        AccessibilityNotification.Announcement(label).post()
    }

    /// Nil when the check was interrupted, such as by signing out.
    private func checkAllParcels() async -> ParcelStore.RefreshResult? {
        let previousOutcome = store.refreshOutcome?.id
        do {
            if case .completed(let result) = try await store.refreshAll() { return result }
            // The store finishes a queued check in the background; wait for its outcome.
            for await refreshing in store.$refreshing.values where !refreshing { break }
            guard let outcome = store.refreshOutcome, outcome.id != previousOutcome else { return nil }
            return outcome.result
        } catch is CancellationError {
            return nil
        } catch let error as URLError where error.code == .cancelled {
            return nil
        } catch {
            return .failed(localizer.errorMessage(error))
        }
    }

    @ViewBuilder private var bottomControls: some View {
        if let parcel = store.undoParcel {
            InlineToast(
                text: localizer.text("app.archivedToast", [
                    "name": parcel.label.nonEmpty ?? localizer.text("common.parcel"),
                ]),
                button: localizer.text("app.undo"),
                symbol: "archivebox.fill",
                tint: ExperimentalPalette.ochre
            ) {
                Task {
                    do { try await store.restore(parcel) }
                    catch { actionError = localizer.errorMessage(error) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 5)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else if let toast {
            InlineToast(
                text: toast.text,
                button: nil,
                symbol: toast.warning ? "exclamationmark.triangle.fill" : "checkmark.circle.fill",
                tint: toast.warning ? Brand.warning : ExperimentalPalette.delivered,
                action: nil
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 5)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: toast) {
                // A newer message gets its own four seconds.
                try? await Task.sleep(for: .seconds(4))
                if self.toast == toast { self.toast = nil }
            }
        } else if shouldShowNotificationInvitation {
            HStack {
                Spacer(minLength: 0)
                NotificationPromptView()
                    .id(session.user?.id)
                    .frame(maxWidth: 380)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private var shouldShowNotificationInvitation: Bool {
        isSelected && (scenePhase == .active || store.notificationEnableInProgress)
            && path.isEmpty && !showingAdd && !showingAccount && !showingFilters && sitePage == nil
            && !showingSearch && !searchFocused && !store.refreshing && actionError == nil
            && addedParcelID == nil && revealParcelID == nil && parcelBurstID == nil
            && store.shouldInviteNotifications
    }

    private var visibleParcels: [Parcel] {
        ParcelOrganizer.visible(
            store.parcels,
            query: query,
            status: statusFilter,
            carrier: carrierFilter,
            sort: sort,
            catalog: catalog
        )
    }

    private var availableCarriers: [CarrierID] {
        Array(Set(store.parcels.map(\.carrier))).sorted {
            catalog.info(for: $0, language: localizer.language).displayName < catalog.info(for: $1, language: localizer.language).displayName
        }
    }

    private var hasCustomView: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || statusFilter != .all || carrierFilter != nil || sort != .priority
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    filterChip("“\(query)”") { query = "" }
                }
                if statusFilter != .all {
                    filterChip(localizer.text(statusFilter.localizationKey)) { statusFilter = .all }
                }
                if let carrierFilter {
                    filterChip(catalog.info(for: carrierFilter, language: localizer.language).displayName) { self.carrierFilter = nil }
                }
                if sort != .priority {
                    filterChip(localizer.text(sort.localizationKey)) { sort = .priority }
                }
                Button(localizer.text("view.clearAll")) { clearFilters() }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 5)
            }
        }
    }

    private func filterChip(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title).lineLimit(1)
                Image(systemName: "xmark").font(.caption2.weight(.bold))
            }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 11)
            .frame(height: 34)
            .background(Brand.ink.opacity(0.06), in: Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Brand.ink)
    }

    private func sectionHeader(_ section: ParcelSection) -> some View {
        HStack(spacing: 9) {
            Text(sectionTitle(section.kind))
                .font(.headline.weight(.semibold))
            Text("\(section.parcels.count)")
                .contentTransition(.numericText())
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .frame(minHeight: 20)
                .background(.secondary.opacity(0.09), in: Capsule())
            Spacer()
        }
        .padding(.top, 3)
    }

    @ViewBuilder private func sectionContent(_ section: ParcelSection, next: Parcel?) -> some View {
        switch section.kind {
        case .delivered:
            VStack(alignment: .leading, spacing: 10) {
                sectionHeader(section)
                ForEach(section.parcels) { parcel in
                    ExperimentalDeliveredParcelCard(
                        parcel: parcel,
                        transition: parcelTransition,
                        onName: { places.name(parcel.id, at: $0) },
                        onOpen: { path.append(parcel.id) },
                        onArchive: { await archive(parcel) }
                    )
                    .modifier(arrivalCelebration(for: parcel.id))
                    .modifier(place(of: parcel.id, leaving: []))
                    .id(parcel.id)
                }
            }

        case .archived:
            if hasCustomView {
                VStack(alignment: .leading, spacing: 10) {
                    sectionHeader(section)
                    ExperimentalArchivedParcelGroup(
                        parcels: section.parcels,
                        transition: parcelTransition,
                        onOpen: { path.append($0) }
                    )
                }
            } else {
                ExperimentalArchiveShelf(
                    parcels: section.parcels,
                    isExpanded: $archivedExpanded,
                    transition: parcelTransition,
                    onOpen: { path.append($0) }
                )
            }

        default:
            VStack(alignment: .leading, spacing: 12) {
                sectionHeader(section)
                ForEach(section.parcels) { parcel in
                    if !hasCustomView, parcel.id == next?.id {
                        ExperimentalNextDeliveryPass(
                            parcel: parcel,
                            transition: parcelTransition,
                            onOpen: { path.append(parcel.id) },
                            onArchive: { await archive(parcel) }
                        )
                        .modifier(arrivalCelebration(for: parcel.id, stubInset: 49))
                        .id(parcel.id)
                    } else {
                        ExperimentalParcelPassCard(
                            parcel: parcel,
                            notice: section.kind == .attention
                                ? parcel.attention().map { localizer.text($0.localizationKey) }
                                : nil,
                            transition: parcelTransition,
                            onOpen: { path.append(parcel.id) },
                            onArchive: parcel.isArchived ? nil : { await archive(parcel) }
                        )
                        .modifier(arrivalCelebration(for: parcel.id))
                        .id(parcel.id)
                    }
                }
            }
        }
    }

    /// Next up, with the parcel as it is now on a card arranged as it was.
    private func nextCard(_ parcel: Parcel, leaving: Set<UUID>) -> some View {
        ExperimentalNextDeliveryPass(
            parcel: shown(parcel), transition: parcelTransition,
            arrived: delivered.holds(parcel.id), onName: { places.name(parcel.id, at: $0) },
            onOpen: { path.append(parcel.id) }, onArchive: { await archive(parcel) }
        )
        .modifier(arrivalCelebration(for: parcel.id, stubInset: 43))
        .modifier(place(of: parcel.id, leaving: leaving))
        .environment(\.pipSight) { places.see(pip: $0, on: parcel.id) }
        .id(parcel.id)
    }

    /// A parcel on its way. A flagged one says what it needs now, which is nothing once it has arrived.
    private func card(_ parcel: Parcel, flagged: Bool, leaving: Set<UUID>) -> some View {
        let arrived = delivered.holds(parcel.id)
        let notice = flagged && !arrived ? shown(parcel).attention().map { localizer.text($0.localizationKey) } : nil
        return ExperimentalParcelPassCard(
            parcel: shown(parcel), notice: notice, transition: parcelTransition,
            arrived: arrived, onName: { places.name(parcel.id, at: $0) },
            onOpen: { path.append(parcel.id) }, onArchive: { await archive(parcel) }
        )
        .modifier(arrivalCelebration(for: parcel.id))
        .modifier(place(of: parcel.id, leaving: leaving))
        .id(parcel.id)
    }

    private func arrangement(of parcels: [Parcel]) -> DeliveryListLayout {
        DeliveryListLayout(
            parcels: parcels, query: query, status: statusFilter,
            carrier: carrierFilter, sort: sort, featuresNext: !hasCustomView
        )
    }

    /// Whether the list is looked at, and may show a card moving.
    private var watching: Bool {
        isSelected && scenePhase == .active && path.isEmpty && !showingAdd && !showingAccount && !showingFilters
            && sitePage == nil && !hasCustomView && !reduceMotion
    }

    /// The parcel as it is now, for a card arranged as it was.
    private func shown(_ parcel: Parcel) -> Parcel {
        delivered.isEmpty ? parcel : store.parcels.first { $0.id == parcel.id } ?? parcel
    }

    private func place(of id: UUID, leaving: Set<UUID>) -> DeliveryCardPlace {
        DeliveryCardPlace(id: id, places: places, flying: flights.contains { $0.id == id }, leaving: leaving.contains(id))
    }

    /// The held parcels take their new places: each card that becomes another is pictured where it
    /// stands and flown to where the list now has it, and the other cards make room.
    private func letGo() {
        let ids = delivered.ids
        guard !ids.isEmpty else { return }
        let now = arrangement(of: store.parcels)
        let changes = arrangement(of: delivered.arranged(store.parcels)).changing(into: now)
        let visible = places.visible
        var taking: [DeliveredFlight] = []
        for parcel in store.parcels {
            // Only a card that shows whole can be pictured whole: another simply takes its new place.
            guard let change = changes[parcel.id], let from = places.place(of: parcel.id),
                  visible?.contains(from.frame) ?? false, let picture = places.picture(of: from.frame) else { continue }
            taking.append(DeliveredFlight(
                id: parcel.id, parcel: parcel, was: change.was, becomes: change.becomes,
                picture: picture, from: from, to: nil, lifted: ids.contains(parcel.id)
            ))
        }
        // The arrivals are drawn last, over the card that takes their place.
        taking.sort { !$0.lifted && $1.lifted }
        for flight in taking { places.forget(flight.id) }
        flightRound += 1
        let round = flightRound
        flightProgress = 0
        flights = taking
        withAnimation(.spring(duration: 0.42)) { delivered.release() }
        guard !taking.isEmpty else { return }
        Task { @MainActor in
            // The list lays its new cards out; one that stays unplaced is beyond the screen, and its picture flies out.
            for _ in 0..<4 {
                try? await Task.sleep(for: .milliseconds(30))
                if flights.allSatisfy({ places.place(of: $0.id) != nil }) { break }
            }
            guard round == flightRound else { return }
            for index in flights.indices {
                let flight = flights[index]
                flights[index].to = places.place(of: flight.id) ?? DeliveryCardPlaces.Place(
                    frame: CGRect(x: flight.from.frame.minX, y: max(flight.from.frame.maxY, visible?.maxY ?? 0) + 40,
                                  width: flight.from.frame.width, height: min(flight.from.frame.height, 102)),
                    title: min(flight.from.title, 50)
                )
            }
            withAnimation(.spring(duration: 0.62, bounce: 0.16)) {
                flightProgress = 1
            } completion: {
                guard round == flightRound else { return }
                flights = []
                flightProgress = 0
            }
        }
    }

    private func arrivalCelebration(for id: UUID, stubInset: CGFloat = 30) -> ParcelArrivalCelebration {
        ParcelArrivalCelebration(active: parcelBurstID == id, stubInset: stubInset) {
            if parcelBurstID == id { parcelBurstID = nil }
        }
    }

    private func sectionTitle(_ kind: ParcelSectionKind) -> String {
        switch kind {
        case .attention: localizer.text("app.needsAttention")
        case .today: localizer.text("app.arrivingToday")
        case .active: localizer.text("app.onTheWaySection")
        case .delivered: localizer.text("app.pastDeliveries")
        case .returned: localizer.text("app.returned")
        case .archived: localizer.text("app.archived")
        }
    }

    /// Returns whether the parcel left the list, so a swiped card only returns after a failure.
    @discardableResult
    private func archive(_ parcel: Parcel) async -> Bool {
        do {
            try await store.archive(parcel)
            return true
        } catch {
            actionError = localizer.errorMessage(error)
            return false
        }
    }

    private func clearFilters() {
        query = ""
        statusFilter = .all
        carrierFilter = nil
        sort = .priority
    }

    /// Opens the sheet that adds a parcel, the way the person asked for it.
    private func add(_ request: FirstParcelRequest) {
        scanning = request == .scan
        if case .paste(let text) = request, let pasted = text.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
            sharedDraft = SharedParcelDraft(trackingInput: String(pasted.prefix(2000)))
        } else {
            sharedDraft = nil
        }
        showingAdd = true
    }

    private func consumeSharedDraft() {
        guard let draft = ShareInbox.consume() else { return }
        DeliveryAnalytics.shared.action("parcel-share-received")
        sharedDraft = draft
        showingAdd = true
    }

    private func consumePendingParcelNotification() {
        openParcelNotification(AppDelegate.consumePendingParcelID())
    }

    private func openParcelNotification(_ parcelID: UUID?) {
        guard let parcelID else { return }
        path = [parcelID]
    }

    /// A parcel kept from a link arrives like one just added; one already followed opens.
    private func receive(_ arrival: ParcelLinkStore.Arrival?) {
        guard let arrival else { return }
        links.consumeArrival()
        let elsewhere = !path.isEmpty || showingAdd || showingAccount || showingFilters || sitePage != nil
        showingAdd = false
        showingAccount = false
        showingFilters = false
        sitePage = nil
        switch arrival {
        case .open(let parcelID):
            path = [parcelID]
        case .added(let parcelID):
            path = []
            let confirmation = localizer.text("link.added")
            toast = ListToast(text: confirmation)
            AccessibilityNotification.Announcement(confirmation).post()
            guard let parcelID, scenePhase == .active else { return }
            if !visibleParcels.contains(where: { $0.id == parcelID }) { clearFilters() }
            Task {
                // Returning to the list clears a pending reveal, so wait until it is back.
                if elsewhere { try? await Task.sleep(for: .milliseconds(500)) }
                revealParcelID = parcelID
            }
        }
    }

    private func handleURL(_ url: URL) {
        switch NativeRoute(url: url) {
        case .parcel(let parcelID):
            path = [parcelID]
        case .friend: break // RootView owns Friends navigation.
        case .add(let trackingInput):
            sharedDraft = SharedParcelDraft(trackingInput: trackingInput)
            showingAdd = true
        case nil:
            break
        }
    }
}

private struct ExperimentalNextDeliveryPass: View {
    let parcel: Parcel
    let transition: Namespace.ID
    /// Just delivered, and still shown where it stood: the card says so before it leaves for the past deliveries.
    var arrived = false
    /// Drawn for its look alone, on a card that flies over the list.
    var decorative = false
    /// Where the parcel's name is written, in the list's space.
    var onName: ((CGFloat) -> Void)?
    let onOpen: () -> Void
    let onArchive: () async -> Bool

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    @State private var atlas: WorldAtlas?
    @ObservedObject private var catalog = CarrierCatalog.shared

    private var identity: CarrierVisualIdentity {
        CarrierVisualIdentity.of(parcel.displayedCarrier, catalog: catalog, language: localizer.language)
    }
    /// Scans with places are drawn as a route across the top of the card, as on the opened parcel.
    private var placed: Bool { parcel.trackingEvents.contains { $0.place != nil } }

    var body: some View {
        if decorative {
            card.allowsHitTesting(false).accessibilityHidden(true)
        } else {
            card
                .matchedTransitionSource(id: parcel.id, in: transition)
                .accessibilityElement(children: .combine)
                .experimentalSwipeToArchive(
                    title: localizer.text("parcel.archive"), cornerRadius: 24,
                    onOpen: onOpen, action: onArchive
                )
                .opacity(appeared ? 1 : 0)
                .accessibilityHint(localizer.text("detail.label"))
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                CarrierFleetMark(identity: identity)
                Spacer(minLength: 0)
                // A parcel that has arrived is nobody's next: the words keep their room and go.
                Text(localizer.text("app.nextUp"))
                    .font(.caption2)
                    .textCase(.uppercase)
                    .tracking(1.2)
                    .foregroundStyle(identity.ink.opacity(0.75))
                    .fixedSize(horizontal: false, vertical: true)
                    .opacity(arrived ? 0 : 1)
                    .accessibilityHidden(arrived)
            }
            HStack(alignment: .center, spacing: 16) {
                Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                    .font(.title2.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named(DeliveryListSpace.name)).midY } action: { onName?($0) }
                DeliveryPostageStamp(parcel: parcel, identity: identity, appeared: appeared || decorative)
            }
            // Room for the route engraved behind the top of the card.
            .padding(.top, placed ? 101 : 19)
            .padding(.bottom, 15)

            AutomaticCarrierNotice(parcel: parcel)
            if parcel.activeTrackingCarrier != parcel.displayedCarrier {
                Text(localizer.text("parcel.deliveryCarrier", ["carrier": catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language).displayName]))
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 5) {
                if arrived { Image(systemName: "checkmark").font(.caption2.weight(.light)).accessibilityHidden(true) }
                Text([localizer.parcelStatus(parcel), parcel.pickupPlace,
                      localizer.parcelDeliveryEstimate(parcel) ?? (arrived ? localizer.parcelCompletionDate(parcel) : nil)]
                    .compactMap { $0 }.joined(separator: " · "))
            }
                .font(.caption)
                .foregroundStyle(identity.ink)
                .fixedSize(horizontal: false, vertical: true)
            if parcel.syncStatus == .error {
                ParcelFlag(text: localizer.text("attention.sync_error"), symbol: "arrow.clockwise")
                    .padding(.top, 8)
            }
        }
        .foregroundStyle(.primary)
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 166, alignment: .leading)
        .background(alignment: .top) {
            if placed, let atlas {
                // The card is one tap target, so the drawing takes no touches of its own.
                RouteEngraving(
                    atlas: atlas, route: ParcelRoute(parcel: parcel, atlas: atlas, language: localizer.language),
                    stage: parcel.currentStage, identity: identity, peek: false,
                    insets: EdgeInsets(top: 40, leading: 16, bottom: 28, trailing: 16), floor: 140
                )
                .frame(height: 160)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24, style: .continuous))
                .allowsHitTesting(false)
                .transition(.opacity)
            }
        }
        .experimentalSurface(fill: identity.surface, cornerRadius: 24)
        .modifier(DeliveredPress(arrived: arrived, dip: 0.982, wait: 0.42))
        .onAppear { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.3)) { appeared = true } }
        .task(id: placed) {
            guard placed, atlas == nil else { return }
            let loaded = await WorldAtlas.bundled.value
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.5)) { atlas = loaded }
        }
    }
}

private struct ExperimentalParcelPassCard: View {
    let parcel: Parcel
    let notice: String?
    let transition: Namespace.ID
    /// Just delivered, and still shown among the parcels on their way.
    var arrived = false
    /// Drawn for its look alone, on a card that flies over the list.
    var decorative = false
    /// Where the parcel's name is written, in the list's space.
    var onName: ((CGFloat) -> Void)?
    let onOpen: () -> Void
    let onArchive: (() async -> Bool)?

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var atlas: WorldAtlas?
    @ObservedObject private var catalog = CarrierCatalog.shared

    private var identity: CarrierVisualIdentity {
        CarrierVisualIdentity.of(parcel.displayedCarrier, catalog: catalog, language: localizer.language)
    }
    private var date: String? { localizer.parcelDeliveryEstimate(parcel) ?? localizer.parcelCompletionDate(parcel) }
    /// Scans with places are drawn as a small route at the end of the card.
    private var placed: Bool { parcel.trackingEvents.contains { $0.place != nil } }
    /// A past delivery's card is paler, once it stands among the past deliveries.
    private var past: Bool { !arrived && (parcel.currentStage?.isFinal == true || parcel.isArchived) }
    /// The words under the top row keep clear of the route.
    private var clearance: CGFloat { placed ? CardRoute.clearance : 0 }
    /// Carrier-reported stages already say what needs attention in the status line.
    private var flag: String? {
        let carrierIssue = [TrackingStage.customs, .readyForPickup, .failedAttempt, .exception].contains { $0 == parcel.currentStage }
        if let notice, !carrierIssue { return notice }
        return parcel.syncStatus == .error ? localizer.text("attention.sync_error") : nil
    }

    var body: some View {
        if decorative {
            card.allowsHitTesting(false).accessibilityHidden(true)
        } else {
            card
                .matchedTransitionSource(id: parcel.id, in: transition)
                .experimentalSwipeToArchive(
                    title: localizer.text("parcel.archive"), cornerRadius: 16, shadow: false,
                    onOpen: onOpen, action: onArchive
                )
                .accessibilityElement(children: .combine)
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 5) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    CarrierFleetMark(identity: identity).fixedSize()
                    Spacer(minLength: 0)
                    if let date { dateLabel(date).fixedSize() }
                }
                VStack(alignment: .leading, spacing: 6) {
                    CarrierFleetMark(identity: identity)
                    if let date { dateLabel(date) }
                }
            }
            .padding(.bottom, 3)
            VStack(alignment: .leading, spacing: 5) {
                Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                    .font(.headline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named(DeliveryListSpace.name)).midY } action: { onName?($0) }
                AutomaticCarrierNotice(parcel: parcel)
                if parcel.activeTrackingCarrier != parcel.displayedCarrier {
                    Text(localizer.text("parcel.deliveryCarrier", ["carrier": catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language).displayName]))
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if flag == nil || parcel.hasCarrierUpdate {
                    HStack(spacing: 5) {
                        if parcel.isDelivered { Image(systemName: "checkmark").font(.caption2.weight(.light)).accessibilityHidden(true) }
                        Text([localizer.parcelStatus(parcel), parcel.pickupPlace].compactMap { $0 }.joined(separator: " · "))
                    }
                        .font(.caption)
                        .foregroundStyle(identity.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let flag {
                    ParcelFlag(text: flag, symbol: parcel.syncStatus == .error ? "arrow.clockwise" : "clock")
                        .padding(.top, 4)
                }
            }
            .padding(.trailing, clearance)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 13)
        .padding(.horizontal, 15)
        .frame(minHeight: 102)
        .background(alignment: .trailing) {
            if placed, let atlas {
                GeometryReader { proxy in
                    CardRoute(atlas: atlas, route: ParcelRoute(parcel: parcel, atlas: atlas, language: localizer.language), ink: identity.ink,
                              surface: past ? Brand.paper.mix(with: identity.surface, by: 0.35, in: .device) : identity.surface)
                        .frame(width: CardRoute.width(in: proxy.size.width))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .transition(.opacity)
            }
        }
        .background {
            RoundedRectangle(cornerRadius: 16).fill(Brand.paper)
                .overlay { RoundedRectangle(cornerRadius: 16).fill(identity.surface.opacity(past ? 0.35 : 1)) }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .modifier(DeliveredPress(arrived: arrived, dip: 1.022, wait: 0.01))
        .task(id: placed) {
            guard placed, atlas == nil else { return }
            let loaded = await WorldAtlas.bundled.value
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.5)) { atlas = loaded }
        }
    }

    private func dateLabel(_ date: String) -> some View {
        Text(date).font(.caption).foregroundStyle(identity.ink)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A problem stays on the parcel's own card instead of replacing it.
private struct ParcelFlag: View {
    let text: String
    let symbol: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.caption2.weight(.semibold)).accessibilityHidden(true)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(Brand.warning)
        .padding(.vertical, 4)
        .padding(.leading, 8)
        .padding(.trailing, 10)
        .background(Brand.paper.opacity(0.72), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ExperimentalDeliveredParcelCard: View {
    let parcel: Parcel
    let transition: Namespace.ID
    var onName: ((CGFloat) -> Void)?
    let onOpen: () -> Void
    let onArchive: (() async -> Bool)?

    var body: some View {
        ExperimentalParcelPassCard(
            parcel: parcel,
            notice: nil,
            transition: transition,
            onName: onName,
            onOpen: onOpen,
            onArchive: onArchive
        )
    }
}

/// A card tells the list where it stands. While its picture flies to another place, the card stays unseen,
/// and one that is about to become another card leaves without fading.
private struct DeliveryCardPlace: ViewModifier {
    let id: UUID
    let places: DeliveryCardPlaces
    let flying: Bool
    let leaving: Bool

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(DeliveryListSpace.name)) } action: { places.stand(id, at: $0) }
            .opacity(flying ? 0 : 1)
            .transition(leaving ? .identity : .opacity)
    }
}

/// The card gives a little as the news of its delivery lands on it.
private struct DeliveredPress: ViewModifier {
    let arrived: Bool
    let dip: CGFloat
    let wait: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let still = reduceMotion
        content.keyframeAnimator(initialValue: CGFloat(1), trigger: arrived) { view, scale in
            view.scaleEffect(still ? 1 : scale)
        } keyframes: { _ in
            KeyframeTrack {
                LinearKeyframe(CGFloat(1), duration: wait)
                CubicKeyframe(dip, duration: 0.17)
                CubicKeyframe(CGFloat(1), duration: 0.3)
            }
        }
    }
}

/// One card on its way to another place in the list. A picture of the card it was and the card it
/// becomes ride in one box: the box changes size from its far edge, the picture slides so that both
/// names stay on one line, and the new card comes up over it.
private struct DeliveredFlightCard: View, Animatable {
    let flight: DeliveredFlight
    var progress: CGFloat
    let transition: Namespace.ID

    @EnvironmentObject private var localizer: Localizer
    @ObservedObject private var catalog = CarrierCatalog.shared

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        let to = flight.to ?? flight.from
        let pose = DeliveredFlightPose(from: flight.from, to: to, was: flight.was, becomes: flight.becomes, lifted: flight.lifted, progress: progress)
        let identity = CarrierVisualIdentity.of(flight.parcel.displayedCarrier, catalog: catalog, language: localizer.language)
        ZStack(alignment: .topLeading) {
            Image(uiImage: flight.picture)
                .resizable()
                .frame(width: flight.from.frame.width, height: flight.from.frame.height)
                .offset(y: pose.leaving)
            ZStack(alignment: .topLeading) {
                // A paler card shows its own ground around it while the box is still tall.
                Rectangle().fill(Brand.paper)
                    .overlay { Rectangle().fill(identity.surface.opacity(flight.becomes == .past ? 0.35 : 1)) }
                face
                    .frame(width: to.frame.width, height: to.frame.height, alignment: .top)
                    .offset(y: pose.arriving)
            }
            .opacity(pose.arrival)
        }
        .frame(width: pose.frame.width, height: pose.frame.height, alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: pose.cornerRadius, style: .continuous))
        .shadow(color: .black.opacity(0.2 * pose.shadow), radius: 14, y: 12)
        .offset(x: pose.frame.minX, y: pose.frame.minY)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var face: some View {
        if flight.becomes == .next {
            ExperimentalNextDeliveryPass(parcel: flight.parcel, transition: transition, decorative: true, onOpen: {}, onArchive: { false })
        } else {
            ExperimentalParcelPassCard(parcel: flight.parcel, notice: nil, transition: transition, decorative: true, onOpen: {}, onArchive: nil)
        }
    }
}

private extension View {
    func experimentalSwipeToArchive(
        title: String,
        cornerRadius: CGFloat,
        shadow: Bool = true,
        onOpen: @escaping () -> Void,
        action: (() async -> Bool)?
    ) -> some View {
        modifier(ExperimentalSwipeToArchiveModifier(
            title: title,
            cornerRadius: cornerRadius,
            shadow: shadow,
            onOpen: onOpen,
            action: action
        ))
    }
}

/// Finger travel to revealed width, and where a released swipe settles. Matches
/// the web card: one to one across the action, resisted up to the commit point,
/// softly bounded after, and a released speed that can open, close or archive.
struct ArchiveSwipeState {
    enum Destination: Equatable { case closed, revealed, archive }
    static let actionWidth: CGFloat = 88
    static let hysteresis: CGFloat = 8
    static let resistance: CGFloat = 0.8
    /// Release speeds in points per second: a flick picks open or closed, a throw past the action archives.
    static let flickSpeed: CGFloat = 110
    static let throwSpeed: CGFloat = 1000
    private(set) var reveal: CGFloat = 0
    private var origin: (travel: CGFloat, slop: CGFloat)?
    /// Unknown until the drag has actually moved.
    private var horizontal: Bool?

    static func commitPoint(width: CGFloat) -> CGFloat {
        max(actionWidth + 56, width * 0.5)
    }

    private static func rubber(_ distance: CGFloat, limit: CGFloat) -> CGFloat {
        limit * (1 - 1 / (1 + resistance * distance / limit))
    }

    private static func unrubber(_ value: CGFloat, limit: CGFloat) -> CGFloat {
        value * limit / (resistance * (limit - value))
    }

    static func reveal(forTravel travel: CGFloat, width: CGFloat) -> CGFloat {
        let commit = commitPoint(width: width)
        let knee = actionWidth + (commit - actionWidth) / resistance
        if travel < 0 { return -rubber(-travel, limit: actionWidth / 2) }
        if travel <= actionWidth { return travel }
        if travel <= knee { return actionWidth + (travel - actionWidth) * resistance }
        return commit + rubber(travel - knee, limit: width - commit)
    }

    /// The finger travel that shows `reveal`, so a caught card continues without a jump.
    static func travel(forReveal reveal: CGFloat, width: CGFloat) -> CGFloat {
        let commit = commitPoint(width: width)
        if reveal < 0 { return -unrubber(min(-reveal, actionWidth / 2 - 0.01), limit: actionWidth / 2) }
        if reveal <= actionWidth { return reveal }
        if reveal <= commit { return actionWidth + (reveal - actionWidth) / resistance }
        return actionWidth + (commit - actionWidth) / resistance
            + unrubber(min(reveal - commit, width - commit - 0.01), limit: width - commit)
    }

    /// `velocity` is the revealing speed: positive while the card moves left.
    static func destination(reveal: CGFloat, velocity: CGFloat, width: CGFloat) -> Destination {
        if reveal >= commitPoint(width: width) || (reveal >= actionWidth && velocity >= throwSpeed) { return .archive }
        if abs(velocity) >= flickSpeed { return velocity > 0 ? .revealed : .closed }
        // Slow releases project their speed the way scrolling momentum would.
        return reveal + velocity * 0.5 > actionWidth / 2 ? .revealed : .closed
    }

    /// The first points of a drag only pick its direction, so the card starts moving without a jump.
    mutating func drag(translation: CGSize, width: CGFloat) {
        if origin == nil {
            // On iOS 27 a recognized pan reports zero first and measures from there, so
            // there is nothing to absorb; earlier versions report the travel so far.
            let slop = min(max(translation.width, -Self.hysteresis), Self.hysteresis)
            origin = (Self.travel(forReveal: reveal, width: width), slop)
        }
        // Judging a zero translation would call every drag vertical.
        if horizontal == nil, translation != .zero {
            horizontal = abs(translation.width) > abs(translation.height)
        }
        guard horizontal == true, let origin else { return }
        reveal = Self.reveal(forTravel: origin.travel - (translation.width - origin.slop), width: width)
    }

    /// `velocity` is the finger's horizontal speed in points per second.
    mutating func release(velocity: CGFloat, width: CGFloat) -> Destination? {
        defer { origin = nil; horizontal = nil }
        guard horizontal == true, origin != nil else { return nil }
        return Self.destination(reveal: reveal, velocity: -velocity, width: width)
    }

    mutating func cancel() -> Destination? {
        defer { origin = nil; horizontal = nil }
        guard horizontal == true, origin != nil else { return nil }
        return reveal > Self.actionWidth / 2 ? .revealed : .closed
    }

    mutating func settle(at reveal: CGFloat) {
        self.reveal = reveal
    }
}

/// A damped spring with a perceptual `duration` and an optional `bounce`, solved in
/// closed form so a motion can hand over to the next one at any moment with its speed.
struct SwipeSpring: Equatable {
    var duration: Double
    var bounce: Double = 0

    static let snap = SwipeSpring(duration: 0.3)
    static let fling = SwipeSpring(duration: 0.42, bounce: 0.15)
    static let leap = SwipeSpring(duration: 0.28)
    static let exit = SwipeSpring(duration: 0.32)
    static let reduced = SwipeSpring(duration: 0.24)

    /// Position and velocity, in units per second, `seconds` after leaving `from` at `velocity`.
    func state(from: Double, to: Double, velocity: Double, at seconds: Double) -> (value: Double, velocity: Double) {
        let omega = 2 * Double.pi / duration
        let damping = 1 - min(max(bounce, 0), 0.9)
        let offset = from - to
        if damping < 1 {
            let decay = damping * omega
            let frequency = omega * (1 - damping * damping).squareRoot()
            let sine = (velocity + decay * offset) / frequency
            let fade = exp(-decay * seconds)
            let cosine = cos(frequency * seconds)
            let sinus = sin(frequency * seconds)
            return (to + fade * (offset * cosine + sine * sinus),
                    fade * (velocity * cosine - (decay * velocity + omega * omega * offset) / frequency * sinus))
        }
        let slope = velocity + omega * offset
        let fade = exp(-omega * seconds)
        return (to + (offset + slope * seconds) * fade, (velocity - omega * slope * seconds) * fade)
    }

    /// Seconds until the spring rests within `precision` of its target.
    func settleTime(from: Double, to: Double, velocity: Double, precision: Double = 0.5) -> Double {
        var seconds = 0.0
        while seconds < 2 {
            let current = state(from: from, to: to, velocity: velocity, at: seconds)
            if abs(current.value - to) < precision && abs(current.velocity) < precision * 20 { return seconds }
            seconds += 1 / 120
        }
        return 2
    }
}

/// How far the card has moved left, whether the action has leapt to the card's
/// edge, and whether its label has moved to the middle of the row.
struct ArchiveSwipePose: Equatable {
    var reveal: CGFloat = 0
    var spread: CGFloat = 0
    var land: CGFloat = 0
}

/// Springs every channel of the pose to a target. The pose at any moment comes
/// from the closed form, so a new motion starts from the current one's position and speed.
struct ArchiveSwipeMotion: Identifiable {
    let id = UUID()
    let start: ArchiveSwipePose
    let target: ArchiveSwipePose
    let velocity: ArchiveSwipePose
    let revealSpring: SwipeSpring
    let leapSpring: SwipeSpring
    /// On the way out the action stays on the card's edge: its gap closes instead of widening.
    let glued: Bool
    let began: Date
    let duration: TimeInterval

    init(from start: ArchiveSwipePose, to target: ArchiveSwipePose, velocity: ArchiveSwipePose = .init(),
         spring: SwipeSpring, reduceMotion: Bool, glued: Bool = false, began: Date = .now) {
        self.start = start
        self.target = target
        self.glued = glued
        self.velocity = reduceMotion ? ArchiveSwipePose() : velocity
        revealSpring = reduceMotion ? .reduced : spring
        leapSpring = reduceMotion ? .reduced : .leap
        self.began = began
        duration = max(
            revealSpring.settleTime(from: start.reveal, to: target.reveal, velocity: self.velocity.reveal),
            leapSpring.settleTime(from: start.spread, to: target.spread, velocity: self.velocity.spread, precision: 0.002),
            leapSpring.settleTime(from: start.land, to: target.land, velocity: self.velocity.land, precision: 0.002)
        )
    }

    private func states(at seconds: Double) -> [(value: Double, velocity: Double)] {
        [revealSpring.state(from: start.reveal, to: target.reveal, velocity: velocity.reveal, at: seconds),
         leapSpring.state(from: start.spread, to: target.spread, velocity: velocity.spread, at: seconds),
         leapSpring.state(from: start.land, to: target.land, velocity: velocity.land, at: seconds)]
    }

    func pose(at date: Date) -> ArchiveSwipePose {
        pose(after: date.timeIntervalSince(began))
    }

    private func pose(after seconds: Double) -> ArchiveSwipePose {
        guard seconds < duration else { return target }
        let channels = states(at: max(0, seconds))
        var pose = ArchiveSwipePose(reveal: channels[0].value, spread: channels[1].value, land: channels[2].value)
        let action = ArchiveSwipeState.actionWidth
        let beyond = min(pose.reveal, target.reveal) - action
        if glued, start.spread < 1, beyond > 0 {
            let gap = (1 - start.spread) * max(0, min(start.reveal, target.reveal) - action)
            let progress = min(1, max(0, (pose.spread - start.spread) / (1 - start.spread)))
            pose.spread = min(1, max(0, 1 - gap * (1 - progress) / beyond))
        }
        return pose
    }

    func velocity(at date: Date) -> ArchiveSwipePose {
        let seconds = date.timeIntervalSince(began)
        guard seconds < duration else { return ArchiveSwipePose() }
        let channels = states(at: max(0, seconds))
        return ArchiveSwipePose(reveal: channels[0].velocity, spread: channels[1].velocity, land: channels[2].velocity)
    }

    /// Seconds from the start until `reached` holds along the way, or the whole motion.
    func time(until reached: (ArchiveSwipePose) -> Bool) -> TimeInterval {
        var seconds = 0.0
        while seconds < duration && !reached(pose(after: seconds)) { seconds += 1 / 120 }
        return min(seconds, duration)
    }
}

/// Decline vertical intent before recognition so the parent scroll view can win.
/// Ignoring vertical values after a SwiftUI DragGesture begins is too late.
final class ArchivePanGestureDelegate: NSObject, UIGestureRecognizerDelegate {
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
        let translation = pan.translation(in: pan.view)
        let direction = translation == .zero ? pan.velocity(in: pan.view) : translation
        return abs(direction.x) > abs(direction.y) * 1.25
    }

    /// The list may start scrolling while a card waits to see the drag's direction;
    /// the card stops that scroll if the drag turns out horizontal.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        guard let archive = gestureRecognizer as? ArchivePanGestureRecognizer,
              other is UIPanGestureRecognizer, other.view is UIScrollView else { return false }
        archive.scroll = other
        return true
    }
}

/// Also reports the press, so a card gives way under a resting finger. The press
/// waits a moment and ends as soon as the finger moves, so starting to scroll
/// does not flash every card it touches.
final class ArchivePanGestureRecognizer: UIPanGestureRecognizer {
    /// A real fingertip's first points wobble, often straight down as it settles, so
    /// the direction is judged only after this much travel. Judging it after 4 points
    /// read most swipes on an iPhone as vertical; simulated drags never showed it.
    static let decisionDistance: CGFloat = 10
    var onPressChanged: ((Bool) -> Void)?
    /// The list's scroll, which may run until the drag shows its direction.
    weak var scroll: UIGestureRecognizer?
    private var pendingPress: DispatchWorkItem?
    private var pressStart: CGPoint?
    private var origin: CGPoint?
    private var scrollStopped = false
    private var pressed = false

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        guard pressStart == nil, let touch = touches.first else { return }
        pressStart = touch.location(in: view)
        // In window space, so a list that starts scrolling does not skew the direction.
        origin = touch.location(in: nil)
        let press = DispatchWorkItem { [weak self] in self?.setPressed(true) }
        pendingPress = press
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: press)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        if let pressStart, let location = touches.first?.location(in: view),
           hypot(location.x - pressStart.x, location.y - pressStart.y) > 6 { endPress() }
        if state == .possible, let origin, let location = touches.first?.location(in: nil) {
            let dx = location.x - origin.x
            let dy = location.y - origin.y
            if hypot(dx, dy) < Self.decisionDistance { return }
            if abs(dx) <= abs(dy) * 1.25 {
                state = .failed
                return
            }
        }
        super.touchesMoved(touches, with: event)
        if state == .began, !scrollStopped, let scroll {
            // Cancel the list's scroll under a card that is being swiped.
            scrollStopped = true
            scroll.isEnabled = false
            scroll.isEnabled = true
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesEnded(touches, with: event)
        endPress()
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesCancelled(touches, with: event)
        endPress()
    }

    override func reset() {
        super.reset()
        endPress()
        pressStart = nil
        origin = nil
        scrollStopped = false
    }

    private func endPress() {
        pendingPress?.cancel()
        pendingPress = nil
        setPressed(false)
    }

    private func setPressed(_ value: Bool) {
        guard pressed != value else { return }
        pressed = value
        onPressChanged?(value)
    }
}

private struct ArchivePanGesture: UIGestureRecognizerRepresentable {
    let onChanged: (CGSize) -> Void
    /// Receives the finger's velocity when it lifts.
    let onEnded: (CGPoint) -> Void
    let onCancelled: () -> Void
    let onPressChanged: (Bool) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> ArchivePanGestureDelegate {
        ArchivePanGestureDelegate()
    }

    func makeUIGestureRecognizer(context: Context) -> ArchivePanGestureRecognizer {
        let recognizer = ArchivePanGestureRecognizer()
        recognizer.maximumNumberOfTouches = 1
        recognizer.delegate = context.coordinator
        recognizer.onPressChanged = onPressChanged
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: ArchivePanGestureRecognizer, context: Context) {
        recognizer.onPressChanged = onPressChanged
    }

    func handleUIGestureRecognizerAction(_ recognizer: ArchivePanGestureRecognizer, context: Context) {
        let translation = context.converter.localTranslation ?? recognizer.translation(in: recognizer.view)
        switch recognizer.state {
        case .began, .changed:
            onChanged(CGSize(width: translation.x, height: translation.y))
        case .ended:
            // The last change can trail the finger; decide from where it lifted.
            onChanged(CGSize(width: translation.x, height: translation.y))
            onEnded(context.converter.localVelocity ?? recognizer.velocity(in: recognizer.view))
        case .cancelled, .failed:
            onCancelled()
        default:
            break
        }
    }
}

private struct ExperimentalSwipeToArchiveModifier: ViewModifier {
    let title: String
    let cornerRadius: CGFloat
    let shadow: Bool
    let onOpen: () -> Void
    let action: (() async -> Bool)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var gestureActive = false
    @State private var pressed = false
    @State private var swipe = ArchiveSwipeState()
    /// The pose at rest or under the finger; `motion` drives it between gestures.
    @State private var pose = ArchiveSwipePose()
    @State private var motion: ArchiveSwipeMotion?
    @State private var armed = false
    @State private var committing = false
    @State private var width: CGFloat = 0
    @State private var archiveFeedback = 0

    private let actionWidth = ArchiveSwipeState.actionWidth
    /// While the action touches the card, it also fills under the card's round corners.
    private let reach: CGFloat = 24

    @ViewBuilder
    func body(content: Content) -> some View {
        if let action {
            // The body reads the pose and hands it to the timeline, so every change redraws
            // the card without relying on the paused timeline's closure.
            let resting = pose
            let running = motion
            let span = rowWidth
            let leapt = armed
            TimelineView(.animation(paused: running == nil)) { timeline in
                let shown = running?.pose(at: timeline.date) ?? resting
                content
                    .offset(x: -min(shown.reveal, span))
                    .background(alignment: .leading) { actionLayers(shown, width: span, armed: leapt, action: action) }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .shadow(
                color: shadow ? .black.opacity(0.035) : .clear,
                radius: shadow ? 10 : 0,
                y: shadow ? 4 : 0
            )
            // The same give as ExperimentalLiftButtonStyle on archived rows.
            .scaleEffect(pressed && !reduceMotion ? 0.975 : 1)
            .offset(y: pressed && !reduceMotion ? 1.5 : 0)
            .brightness(pressed ? -0.025 : 0)
            .contentShape(Rectangle())
            .onGeometryChange(for: CGFloat.self) { geometry in
                geometry.size.width
            } action: { nextWidth in
                width = nextWidth
            }
            .simultaneousGesture(tapGesture, including: .gesture)
            .gesture(swipeGesture(action: action))
            .onDisappear(perform: cancelSwipe)
            .task(id: motion?.id) { await finishMotion() }
            .allowsHitTesting(!committing)
            .sensoryFeedback(.impact(weight: .medium, intensity: 0.9), trigger: armed) { wasArmed, isArmed in
                !wasArmed && isArmed
            }
            .sensoryFeedback(.impact(weight: .medium, intensity: 0.8), trigger: archiveFeedback)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { onOpen() }
            .accessibilityAction(named: Text(title)) { trigger(action, provideFeedback: true) }
        } else {
            content
                .contentShape(Rectangle())
                .onTapGesture(perform: onOpen)
                .accessibilityAddTraits(.isButton)
        }
    }

    private var rowWidth: CGFloat { max(width, actionWidth) }

    private func displayedPose(at date: Date) -> ArchiveSwipePose {
        motion?.pose(at: date) ?? pose
    }

    /// A soft tray behind the card, and the action that rides on the card's edge
    /// until it is fully shown, then leaps to that edge past the commit point.
    private func actionLayers(_ shown: ArchiveSwipePose, width: CGFloat, armed: Bool,
                              action: @escaping () async -> Bool) -> some View {
        let visible = min(shown.reveal, width)
        let tray = max(0, actionWidth - visible)
        let shift = shown.spread * max(0, visible - actionWidth)
        let blockStart = tray + width - actionWidth - shift
        let gap = (1 - shown.spread) * max(0, visible - actionWidth)
        return ZStack(alignment: .leading) {
            Brand.warningSoft
                .offset(x: tray)
            Brand.warning
                .frame(width: width)
                .offset(x: blockStart)
            // Only while the action touches the card; otherwise the tray shows in the gap. It stays
            // solid across the last few points of a leap, which would leave a hairline of tray.
            Brand.warning
                .frame(width: reach)
                .offset(x: blockStart - reach)
                .opacity(min(1, max(0, 1 - (gap - 3) / 6)))
            Button {
                trigger(action, provideFeedback: true)
            } label: {
                VStack(spacing: 5) {
                    Image(systemName: "archivebox.fill")
                        .font(.system(size: 18, weight: .bold))
                        .scaleEffect(armed && !reduceMotion ? 1.2 : 1)
                        .symbolEffect(.bounce, value: armed && !reduceMotion)
                    Text(title)
                        .font(.caption2.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .foregroundStyle(Brand.color(light: "#FFFFFF", dark: "#292820"))
                .frame(width: actionWidth)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // On the way out the label moves to the middle of the row.
            .offset(x: blockStart + shown.land * (shift - (width - actionWidth) / 2))
            .allowsHitTesting(visible >= 8)
            .accessibilityHidden(visible < 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        // Hidden at rest, so no colour shows through the card's anti-aliased corners.
        .opacity(visible > 0.25 ? 1 : 0)
    }

    private var tapGesture: some Gesture {
        SpatialTapGesture()
            .onEnded { value in
                handleTap(at: value.location)
            }
    }

    private func swipeGesture(action: @escaping () async -> Bool) -> ArchivePanGesture {
        ArchivePanGesture(
            onChanged: { translation in
                guard !committing else { return }
                let now = Date()
                quietly {
                    if !gestureActive {
                        gestureActive = true
                        // Catch the card wherever it is on screen.
                        swipe.settle(at: displayedPose(at: now).reveal)
                    }
                    swipe.drag(translation: translation, width: rowWidth)
                    follow(at: now)
                }
                setArmed(swipe.reveal >= ArchiveSwipeState.commitPoint(width: rowWidth))
            },
            onEnded: { velocity in
                gestureActive = false
                guard !committing, let destination = swipe.release(velocity: velocity.x, width: rowWidth) else {
                    setArmed(false)
                    return
                }
                if destination == .archive {
                    trigger(action, velocity: -velocity.x, provideFeedback: false)
                } else {
                    setArmed(false)
                    settle(destination, velocity: -velocity.x)
                }
            },
            onCancelled: cancelSwipe,
            onPressChanged: { isPressed in
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) { pressed = isPressed }
            }
        )
    }

    /// Our own motion draws every frame; SwiftUI must not animate these changes again.
    private func quietly(_ change: () -> Void) {
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction, change)
    }

    /// Keep the card under the finger while the action leaps to or from its edge.
    private func follow(at now: Date) {
        let shown = displayedPose(at: now)
        let speed = motion?.velocity(at: now) ?? ArchiveSwipePose()
        let leapt: CGFloat = swipe.reveal >= ArchiveSwipeState.commitPoint(width: rowWidth) ? 1 : 0
        let target = ArchiveSwipePose(reveal: swipe.reveal, spread: leapt)
        let start = ArchiveSwipePose(reveal: swipe.reveal, spread: shown.spread, land: shown.land)
        if reduceMotion || (abs(start.spread - leapt) < 0.001 && abs(speed.spread) < 0.01 && abs(start.land) < 0.001) {
            pose = target
            motion = nil
        } else {
            motion = ArchiveSwipeMotion(from: start, to: target, velocity: ArchiveSwipePose(spread: speed.spread, land: speed.land),
                                        spring: .snap, reduceMotion: reduceMotion, began: now)
        }
    }

    private func finishMotion() async {
        guard let current = motion else { return }
        try? await Task.sleep(for: .seconds(max(0, current.duration - Date().timeIntervalSince(current.began))))
        guard !Task.isCancelled, motion?.id == current.id else { return }
        quietly {
            pose = current.target
            motion = nil
        }
    }

    private func setArmed(_ value: Bool) {
        guard armed != value else { return }
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.22, extraBounce: 0.16)) { armed = value }
    }

    private func cancelSwipe() {
        gestureActive = false
        setArmed(false)
        guard !committing, let destination = swipe.cancel() else { return }
        settle(destination)
    }

    /// Spring to the closed or revealed position, keeping the current speed unless the finger gave one.
    private func settle(_ destination: ArchiveSwipeState.Destination, velocity: CGFloat? = nil) {
        let now = Date()
        let shown = displayedPose(at: now)
        let speed = motion?.velocity(at: now) ?? ArchiveSwipePose()
        let reveal = destination == .revealed ? actionWidth : 0
        let flung = destination == .revealed && (velocity ?? 0) >= ArchiveSwipeState.flickSpeed
        quietly {
            swipe.settle(at: reveal)
            motion = ArchiveSwipeMotion(
                from: shown, to: ArchiveSwipePose(reveal: reveal),
                velocity: ArchiveSwipePose(reveal: velocity ?? speed.reveal, spread: speed.spread, land: speed.land),
                spring: flung ? .fling : .snap, reduceMotion: reduceMotion, began: now
            )
        }
    }

    private func handleTap(at location: CGPoint) {
        guard !committing else { return }
        let shown = displayedPose(at: .now)
        if shown.reveal > 1 {
            guard location.x < rowWidth - shown.reveal else { return }
            settle(.closed)
            return
        }
        onOpen()
    }

    private func trigger(_ action: @escaping () async -> Bool, velocity: CGFloat? = nil, provideFeedback: Bool) {
        guard !committing else { return }
        committing = true
        if provideFeedback { archiveFeedback += 1 }
        let now = Date()
        let shown = displayedPose(at: now)
        let speed = motion?.velocity(at: now) ?? ArchiveSwipePose()
        let width = rowWidth
        let exit = ArchiveSwipeMotion(
            from: shown, to: ArchiveSwipePose(reveal: width, spread: 1, land: 1),
            velocity: ArchiveSwipePose(reveal: max(0, velocity ?? speed.reveal), spread: speed.spread, land: speed.land),
            spring: .exit, reduceMotion: reduceMotion, glued: true, began: now
        )
        quietly {
            swipe.settle(at: width)
            motion = exit
        }
        // The row leaves the list once the card is out of sight and the label has nearly centred.
        let leave = exit.time { $0.reveal >= width - 2 && $0.land >= 0.92 }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(leave))
            // The list removes the row at once; it comes back only when archiving failed.
            let archived = await action()
            guard !archived else { return }
            committing = false
            setArmed(false)
            settle(.closed)
        }
    }
}

private struct ExperimentalArchiveShelf: View {
    let parcels: [Parcel]
    @Binding var isExpanded: Bool
    let transition: Namespace.ID
    let onOpen: (UUID) -> Void

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let copy = ExperimentalCopy(localizer: localizer)

        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.3, extraBounce: 0.02)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "archivebox")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(width: 22)

                    Text(localizer.text("app.archived"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Spacer(minLength: 6)

                    Text("(\(parcels.count))").font(.caption.monospacedDigit()).foregroundStyle(.secondary)

                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.regular))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .padding(.vertical, 9)
                .padding(.horizontal, 2)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(ExperimentalLiftButtonStyle())
            .accessibilityLabel("\(localizer.text("app.archived")), \(parcels.count)")
            .accessibilityHint(isExpanded ? copy.hideArchive : copy.showArchive)

            if isExpanded {
                VStack(spacing: 0) {
                    ForEach(Array(parcels.enumerated()), id: \.element.id) { index, parcel in
                        ExperimentalArchivedParcelRow(
                            parcel: parcel,
                            transition: transition,
                            onOpen: { onOpen(parcel.id) }
                        )
                        if index < parcels.count - 1 {
                            Divider().padding(.leading, 48)
                        }
                    }
                }
                .experimentalSurface(cornerRadius: 18, shadow: false)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .sensoryFeedback(.selection, trigger: isExpanded)
    }
}

private struct ExperimentalArchivedParcelGroup: View {
    let parcels: [Parcel]
    let transition: Namespace.ID
    let onOpen: (UUID) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(parcels.enumerated()), id: \.element.id) { index, parcel in
                ExperimentalArchivedParcelRow(
                    parcel: parcel,
                    transition: transition,
                    onOpen: { onOpen(parcel.id) }
                )
                if index < parcels.count - 1 {
                    Divider().padding(.leading, 48)
                }
            }
        }
        .experimentalSurface(cornerRadius: 18, shadow: false)
    }
}

private struct ExperimentalArchivedParcelRow: View {
    let parcel: Parcel
    let transition: Namespace.ID
    let onOpen: () -> Void

    @EnvironmentObject private var localizer: Localizer
    @ObservedObject private var catalog = CarrierCatalog.shared

    var body: some View {
        let tint = ExperimentalPalette.tint(for: parcel)

        Button(action: onOpen) {
            HStack(spacing: 10) {
                Image(systemName: parcel.currentStage?.metadata.symbol ?? "shippingbox.fill")
                    .font(.subheadline)
                    .foregroundStyle(tint)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 3) {
                    Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text("\(catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language).displayName) · \(localizer.parcelStatus(parcel))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 6)

                if let date = parcel.experimentalArchivedDisplayDate {
                    Text(localizer.shortDate(date))
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 13)
            .frame(minHeight: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(ExperimentalLiftButtonStyle())
        .matchedTransitionSource(id: parcel.id, in: transition)
        .accessibilityElement(children: .combine)
    }
}

private extension Parcel {
    var experimentalCompletionDate: Date? {
        guard let event = currentEvent, event.stage.isFinal else { return nil }
        return DateParser.date(event.occurredAt)
    }

    var experimentalArchivedDisplayDate: Date? {
        experimentalCompletionDate ?? archivedAt.flatMap(DateParser.date)
    }
}
