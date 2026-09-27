import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

struct ParcelListView: View {
    @EnvironmentObject private var localizer: Localizer
    @Binding var selection: Int

    var body: some View {
        TabView(selection: $selection) {
            DeliveryListView(isSelected: selection == 0)
                .tag(0)
                .tabItem {
                    Label(localizer.text("native.deliveries"), systemImage: "shippingbox.fill")
                }

            PassportView()
                .tag(1)
                .tabItem {
                    Label(ExperimentalCopy(localizer: localizer).passport, systemImage: "book.closed.fill")
                }

            FriendsView()
                .tag(2)
                .tabItem { Label(localizer.text("friends.title"), systemImage: "person.2.fill") }
        }
        .tint(Brand.ink)
        .sensoryFeedback(.selection, trigger: selection)
        .onChange(of: selection) { _, tab in
            DeliveryAnalytics.shared.view(tab == 1 ? "passport" : tab == 2 ? "friends" : "deliveries")
        }
    }
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

private struct DeliveryListView: View {
    let isSelected: Bool
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var localizer: Localizer
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
    @State private var archivedExpanded = false
    @State private var sharedDraft: SharedParcelDraft?
    @State private var toast: ListToast?
    @State private var actionError: String?
    @State private var pull = PullToRefreshModel()

    @ObservedObject private var catalog = CarrierCatalog.shared

    private struct ListToast: Equatable {
        let text: String
        var warning = false
    }

    var body: some View {
        // Filtering, sorting and grouping run once per render, not once per section.
        let layout = DeliveryListLayout(
            parcels: store.parcels, query: query, status: statusFilter,
            carrier: carrierFilter, sort: sort, featuresNext: !hasCustomView
        )
        NavigationStack(path: $path) {
            ZStack {
                ExperimentalBackdrop()
                content(layout)
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
            if let id = addedParcelID, scenePhase == .active {
                if !visibleParcels.contains(where: { $0.id == id }) { clearFilters() }
                revealParcelID = id
            }
            addedParcelID = nil
        }) {
            AddParcelView(draft: sharedDraft, onOpenParcel: { parcelID in
                showingAdd = false
                path = [parcelID]
            }, onAdded: { id in
                if showingAdd && scenePhase == .active { addedParcelID = id }
            })
                .environmentObject(store)
                .environmentObject(localizer)
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
        .onDisappear { addedParcelID = nil; revealParcelID = nil; parcelBurstID = nil }
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
        .onChange(of: store.undoParcel?.id) { _, next in
            guard let next else { return }
            Task {
                try? await Task.sleep(for: .seconds(7))
                if store.undoParcel?.id == next { store.undoParcel = nil }
            }
        }
    }

    private func content(_ layout: DeliveryListLayout) -> some View {
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
                        if let nextParcel = layout.next {
                            ExperimentalNextDeliveryPass(parcel: nextParcel, transition: parcelTransition,
                                onOpen: { path.append(nextParcel.id) }, onArchive: { await archive(nextParcel) })
                                .modifier(arrivalCelebration(for: nextParcel.id, stubInset: 43))
                                .id(nextParcel.id)
                        }
                        ForEach(layout.attention) { parcel in
                            ExperimentalParcelPassCard(parcel: parcel,
                                notice: parcel.attention().map { localizer.text($0.localizationKey) },
                                transition: parcelTransition,
                                onOpen: { path.append(parcel.id) }, onArchive: { await archive(parcel) })
                                .modifier(arrivalCelebration(for: parcel.id))
                                .id(parcel.id)
                        }
                        ForEach(layout.remaining) { parcel in
                            ExperimentalParcelPassCard(parcel: parcel, notice: nil, transition: parcelTransition,
                                onOpen: { path.append(parcel.id) }, onArchive: { await archive(parcel) })
                                .modifier(arrivalCelebration(for: parcel.id))
                                .id(parcel.id)
                        }
                    }
                    ForEach(layout.sections) { section in sectionContent(section, next: layout.next) }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 28)
                .animation(reduceMotion ? nil : .snappy(duration: 0.32), value: store.parcels.filter { !$0.isArchived }.map(\.id))
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
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6).frame(minHeight: 20)
                    .background(.secondary.opacity(0.09), in: Capsule())
            }
            Spacer(minLength: 0)
            Button {
                showingSearch.toggle()
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

    private var searchControls: some View {
        HStack(spacing: 8) {
            TextField(localizer.text("view.searchPlaceholder"), text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searchFocused)
                .onAppear { searchFocused = true }
                .accessibilityLabel(localizer.text("view.search"))
                .padding(.horizontal, 12).frame(minHeight: 44)
                .background(Brand.paper, in: RoundedRectangle(cornerRadius: 12))
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle").frame(width: 44, height: 44)
                }.accessibilityLabel(localizer.text("view.clear"))
            }
            Button { searchFocused = false; showingFilters = true } label: {
                Image(systemName: "line.3.horizontal.decrease").frame(width: 44, height: 44)
            }
            .accessibilityLabel(localizer.text("view.showControls"))
        }
        .font(.subheadline)
        .buttonStyle(.plain)
        .onKeyPress(.escape) { showingSearch = false; searchFocused = false; return .handled }
    }

    @ViewBuilder private func listEmptyState(_ layout: DeliveryListLayout) -> some View {
        if !store.loading {
            if store.parcels.isEmpty {
                VStack(spacing: 18) {
                    ContentUnavailableView(localizer.text("app.emptyTitle"), systemImage: "shippingbox",
                        description: Text(localizer.text("app.emptyDescription")))
                    Button(localizer.text("app.addParcel")) { sharedDraft = nil; showingAdd = true }
                        .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
                }.frame(maxWidth: .infinity).padding(.vertical, 32)
            } else if layout.visible.isEmpty {
                ContentUnavailableView {
                    Label(localizer.text("view.noResultsTitle"), systemImage: "magnifyingglass")
                } description: { Text(localizer.text("view.noResultsDescription")) }
                actions: { Button(localizer.text("view.clear")) { clearFilters() } }
                    .frame(maxWidth: .infinity).padding(.vertical, 32)
            } else if !hasCustomView, store.errorMessage == nil, store.parcels.allSatisfy(\.isDelivered) {
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

    private enum CheckOutcome { case checked, failed(String), interrupted }

    /// Holds the pull open until every parcel has been checked, then shows the
    /// result on the seal before letting go, as the web app does.
    private func refreshFromPull() async {
        pull.begin(label: localizer.text("app.refreshing"))
        let started = ContinuousClock.now
        let outcome = await checkAllParcels()
        // A check that answers at once still shows the arrow turning.
        try? await Task.sleep(until: started + .milliseconds(900), clock: .continuous)
        switch outcome {
        case .checked:
            finishPull(succeeded: true, label: localizer.text("app.refreshComplete"))
            try? await Task.sleep(for: .milliseconds(700))
        case .failed(let message):
            finishPull(succeeded: false, label: localizer.text("detail.checkFailed"))
            try? await Task.sleep(for: .milliseconds(1100))
            toast = ListToast(text: message, warning: true)
        case .interrupted:
            break
        }
        pull.settle()
    }

    private func refreshForVoiceOver() async {
        switch await checkAllParcels() {
        case .checked:
            AccessibilityNotification.Announcement(localizer.text("app.refreshComplete")).post()
        case .failed(let message):
            toast = ListToast(text: message, warning: true)
            AccessibilityNotification.Announcement(message).post()
        case .interrupted:
            break
        }
    }

    private func finishPull(succeeded: Bool, label: String) {
        pull.finish(succeeded: succeeded, label: label)
        AccessibilityNotification.Announcement(label).post()
    }

    private func checkAllParcels() async -> CheckOutcome {
        let previousOutcome = store.refreshOutcome?.id
        do {
            if try await store.refreshAll() == .completed { return .checked }
            pull.update(label: localizer.text("sync.running"))
            // The store finishes a queued check in the background; wait for its outcome.
            for await refreshing in store.$refreshing.values where !refreshing { break }
            guard let outcome = store.refreshOutcome, outcome.id != previousOutcome else { return .interrupted }
            return outcome.failure.map(CheckOutcome.failed) ?? .checked
        } catch is CancellationError {
            return .interrupted
        } catch let error as URLError where error.code == .cancelled {
            return .interrupted
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
            && path.isEmpty && !showingAdd && !showingAccount && !showingFilters
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
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().stroke(Brand.warning.opacity(0.25), lineWidth: 0.7))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Brand.ink)
    }

    private func sectionHeader(_ section: ParcelSection) -> some View {
        HStack(spacing: 9) {
            Text(sectionTitle(section.kind))
                .font(.headline.weight(.semibold))
            Text("\(section.parcels.count)")
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
                        onOpen: { path.append(parcel.id) },
                        onArchive: { await archive(parcel) }
                    )
                    .modifier(arrivalCelebration(for: parcel.id))
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
    let onOpen: () -> Void
    let onArchive: () async -> Bool

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    @ObservedObject private var catalog = CarrierCatalog.shared

    private var identity: CarrierVisualIdentity {
        CarrierVisualIdentity.of(parcel.displayedCarrier, catalog: catalog, language: localizer.language)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                CarrierFleetMark(identity: identity)
                Spacer(minLength: 0)
                Text(localizer.text("app.nextUp"))
                    .font(.caption2)
                    .textCase(.uppercase)
                    .tracking(1.2)
                    .foregroundStyle(identity.ink.opacity(0.75))
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .center, spacing: 16) {
                Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                    .font(.title2.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                DeliveryPostageStamp(stage: parcel.currentStage, appeared: appeared)
                    .scaleEffect(0.8).frame(width: 43, height: 53)
            }
            .padding(.top, 19)
            .padding(.bottom, 15)

            AutomaticCarrierNotice(parcel: parcel)
            if parcel.activeTrackingCarrier != parcel.displayedCarrier {
                Text(localizer.text("parcel.deliveryCarrier", ["carrier": catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language).displayName]))
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text([localizer.parcelStatus(parcel), localizer.parcelDeliveryEstimate(parcel)]
                .compactMap { $0 }.joined(separator: " · "))
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
        .experimentalSurface(fill: identity.surface, cornerRadius: 24)
        .matchedTransitionSource(id: parcel.id, in: transition)
        .accessibilityElement(children: .combine)
        .experimentalSwipeToArchive(
            title: localizer.text("parcel.archive"), cornerRadius: 24,
            onOpen: onOpen, action: onArchive
        )
        .opacity(appeared ? 1 : 0)
        .accessibilityHint(localizer.text("detail.label"))
        .onAppear { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.3)) { appeared = true } }
    }
}

private struct ExperimentalParcelPassCard: View {
    let parcel: Parcel
    let notice: String?
    let transition: Namespace.ID
    let onOpen: () -> Void
    let onArchive: (() async -> Bool)?

    @EnvironmentObject private var localizer: Localizer
    @ObservedObject private var catalog = CarrierCatalog.shared

    private var identity: CarrierVisualIdentity {
        CarrierVisualIdentity.of(parcel.displayedCarrier, catalog: catalog, language: localizer.language)
    }
    private var date: String? { localizer.parcelDeliveryEstimate(parcel) ?? localizer.parcelCompletionDate(parcel) }
    /// Carrier-reported stages already say what needs attention in the status line.
    private var flag: String? {
        let carrierIssue = [TrackingStage.customs, .readyForPickup, .failedAttempt, .exception].contains { $0 == parcel.currentStage }
        if let notice, !carrierIssue { return notice }
        return parcel.syncStatus == .error ? localizer.text("attention.sync_error") : nil
    }

    var body: some View {
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
            Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                .font(.headline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            AutomaticCarrierNotice(parcel: parcel)
            if parcel.activeTrackingCarrier != parcel.displayedCarrier {
                Text(localizer.text("parcel.deliveryCarrier", ["carrier": catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language).displayName]))
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if flag == nil || parcel.hasCarrierUpdate {
                HStack(spacing: 5) {
                    if parcel.isDelivered { Image(systemName: "checkmark").font(.caption2.weight(.light)).accessibilityHidden(true) }
                    Text(localizer.parcelStatus(parcel))
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 13)
        .padding(.horizontal, 15)
        .frame(minHeight: 102)
        .background {
            RoundedRectangle(cornerRadius: 16).fill(Brand.paper)
                .overlay { RoundedRectangle(cornerRadius: 16).fill(identity.surface.opacity(parcel.currentStage?.isFinal == true || parcel.isArchived ? 0.35 : 1)) }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .matchedTransitionSource(id: parcel.id, in: transition)
        .experimentalSwipeToArchive(
            title: localizer.text("parcel.archive"), cornerRadius: 16, shadow: false,
            onOpen: onOpen, action: onArchive
        )
        .accessibilityElement(children: .combine)
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
    let onOpen: () -> Void
    let onArchive: (() async -> Bool)?

    var body: some View {
        ExperimentalParcelPassCard(
            parcel: parcel,
            notice: nil,
            transition: transition,
            onOpen: onOpen,
            onArchive: onArchive
        )
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
    private var horizontal = false

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
            horizontal = abs(translation.width) > abs(translation.height)
            let slop = min(max(translation.width, -Self.hysteresis), Self.hysteresis)
            origin = (Self.travel(forReveal: reveal, width: width), slop)
        }
        guard horizontal, let origin else { return }
        reveal = Self.reveal(forTravel: origin.travel - (translation.width - origin.slop), width: width)
    }

    /// `velocity` is the finger's horizontal speed in points per second.
    mutating func release(velocity: CGFloat, width: CGFloat) -> Destination? {
        defer { origin = nil; horizontal = false }
        guard horizontal, origin != nil else { return nil }
        return Self.destination(reveal: reveal, velocity: -velocity, width: width)
    }

    mutating func cancel() -> Destination? {
        defer { origin = nil; horizontal = false }
        guard horizontal, origin != nil else { return nil }
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
}

/// Also reports the press, so a card gives way under a resting finger. The press
/// waits a moment and ends as soon as the finger moves, so starting to scroll
/// does not flash every card it touches.
final class ArchivePanGestureRecognizer: UIPanGestureRecognizer {
    var onPressChanged: ((Bool) -> Void)?
    private var pendingPress: DispatchWorkItem?
    private var pressStart: CGPoint?
    private var pressed = false

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        guard pressStart == nil, let touch = touches.first else { return }
        pressStart = touch.location(in: view)
        let press = DispatchWorkItem { [weak self] in self?.setPressed(true) }
        pendingPress = press
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: press)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesMoved(touches, with: event)
        guard let pressStart, let location = touches.first?.location(in: view) else { return }
        if hypot(location.x - pressStart.x, location.y - pressStart.y) > 6 { endPress() }
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
            TimelineView(.animation(paused: motion == nil)) { timeline in
                let shown = displayedPose(at: timeline.date)
                content
                    .offset(x: -min(shown.reveal, rowWidth))
                    .background(alignment: .leading) { actionLayers(shown, action: action) }
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
    private func actionLayers(_ shown: ArchiveSwipePose, action: @escaping () async -> Bool) -> some View {
        let width = rowWidth
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
            // Only while the action touches the card; otherwise the tray shows in the gap.
            Brand.warning
                .frame(width: reach)
                .offset(x: blockStart - reach)
                .opacity(max(0, 1 - gap / 6))
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
