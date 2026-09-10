import SwiftUI
import UIKit

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
    @Environment(\.scenePhase) private var scenePhase

    @Namespace private var parcelTransition
    @State private var path: [UUID] = []
    @State private var query = ""
    @State private var statusFilter: ParcelStatusFilter = .all
    @State private var carrierFilter: CarrierID?
    @State private var sort: ParcelSort = .priority
    @State private var showingFilters = false
    @State private var showingSearch = false
    @State private var refreshing = false
    @FocusState private var searchFocused: Bool
    @State private var showingAdd = false
    @State private var addedParcelID: UUID?
    @State private var revealParcelID: UUID?
    @State private var parcelBurstID: UUID?
    @State private var showingAccount = false
    @State private var archivedExpanded = false
    @State private var sharedDraft: SharedParcelDraft?
    @State private var actionMessage: String?
    @State private var actionError: String?

    @ObservedObject private var catalog = CarrierCatalog.shared

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                ExperimentalBackdrop()
                content
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
        .sheet(isPresented: $showingAdd, onDismiss: {
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

    private var content: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 10) {
                        if !store.parcels.isEmpty { listOverview }
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
                        listEmptyState
                        ForEach(attentionParcels) { parcel in
                            DeliveryAttentionNotice(parcel: parcel, transition: parcelTransition,
                                onOpen: { path.append(parcel.id) }, onArchive: { await archive(parcel) })
                                .modifier(arrivalCelebration(for: parcel.id))
                                .id(parcel.id)
                        }
                        if let nextParcel {
                            ExperimentalNextDeliveryPass(parcel: nextParcel, transition: parcelTransition,
                                onOpen: { path.append(nextParcel.id) }, onArchive: { await archive(nextParcel) })
                                .modifier(arrivalCelebration(for: nextParcel.id, stubInset: 43))
                                .id(nextParcel.id)
                        }
                        ForEach(remainingActiveParcels) { parcel in
                            ExperimentalParcelPassCard(parcel: parcel, notice: nil, transition: parcelTransition,
                                onOpen: { path.append(parcel.id) }, onArchive: { await archive(parcel) })
                                .modifier(arrivalCelebration(for: parcel.id))
                                .id(parcel.id)
                        }
                    }
                    ForEach(sections) { section in sectionContent(section) }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 28)
                .animation(reduceMotion ? nil : .snappy(duration: 0.32), value: store.parcels.filter { !$0.isArchived }.map(\.id))
            }
            .scrollIndicators(.hidden)
            .refreshable { await refreshDeliveries() }
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

    private var listOverview: some View {
        HStack(spacing: 8) {
            if !activeParcels.isEmpty {
                Text(localizer.text("app.onTheWaySection"))
                    .font(.headline.weight(.semibold))
                Text("\(activeParcels.count)")
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
            Button { Task { await refreshDeliveries() } } label: {
                Group {
                    if refreshing { ProgressView() }
                    else { Image(systemName: "arrow.clockwise").font(.body.weight(.regular)) }
                }.frame(width: 44, height: 44)
            }
            .disabled(refreshing)
            .accessibilityLabel(localizer.text(refreshing ? "app.refreshing" : "app.refresh"))
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

    @ViewBuilder private var listEmptyState: some View {
        if !store.loading {
            if store.parcels.isEmpty {
                VStack(spacing: 18) {
                    ContentUnavailableView(localizer.text("app.emptyTitle"), systemImage: "shippingbox",
                        description: Text(localizer.text("app.emptyDescription")))
                    Button(localizer.text("app.addParcel")) { sharedDraft = nil; showingAdd = true }
                        .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
                }.frame(maxWidth: .infinity).padding(.vertical, 32)
            } else if visibleParcels.isEmpty {
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

    private func refreshDeliveries() async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        do { try await store.refreshAll(); actionMessage = localizer.text("app.refreshQueued") }
        catch { actionError = localizer.errorMessage(error) }
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
        } else if let actionMessage {
            InlineToast(
                text: actionMessage,
                button: nil,
                symbol: "checkmark.circle.fill",
                tint: ExperimentalPalette.delivered,
                action: nil
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 5)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task {
                try? await Task.sleep(for: .seconds(4))
                self.actionMessage = nil
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
            && !showingSearch && !searchFocused && !refreshing && actionError == nil
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

    private var activeParcels: [Parcel] { visibleParcels.filter(\.isActive) }

    private var attentionParcels: [Parcel] {
        let featuredID = nextParcel?.id
        return activeParcels.filter { $0.id != featuredID && $0.attention() != nil }
    }

    private var remainingActiveParcels: [Parcel] {
        let featuredID = nextParcel?.id
        return activeParcels.filter { $0.id != featuredID && $0.attention() == nil }
    }

    private var sections: [ParcelSection] {
        ParcelOrganizer.sections(from: visibleParcels).filter {
            $0.kind == .delivered || $0.kind == .returned || $0.kind == .archived
        }
    }

    private var availableCarriers: [CarrierID] {
        Array(Set(store.parcels.map(\.carrier))).sorted {
            catalog.info(for: $0, language: localizer.language).displayName < catalog.info(for: $1, language: localizer.language).displayName
        }
    }

    private var nextParcel: Parcel? {
        hasCustomView ? nil : ParcelOrganizer.nextDelivery(from: activeParcels)
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

    @ViewBuilder private func sectionContent(_ section: ParcelSection) -> some View {
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
                    if !hasCustomView, parcel.id == nextParcel?.id {
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

    private func archive(_ parcel: Parcel) async {
        do { try await store.archive(parcel) }
        catch { actionError = localizer.errorMessage(error) }
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

private struct DeliveryAttentionNotice: View {
    let parcel: Parcel
    let transition: Namespace.ID
    let onOpen: () -> Void
    let onArchive: () async -> Void
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: parcel.currentStage?.metadata.symbol ?? "info.circle")
                .font(.system(size: 16, weight: .light)).foregroundStyle(Brand.warning).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(parcel.attention().map { localizer.text($0.localizationKey) } ?? localizer.parcelStatus(parcel))
                    .font(.subheadline.weight(.medium))
                Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                    .font(.caption).foregroundStyle(.secondary)
                if let sender = parcel.carrierData?.senderName?.nonEmpty {
                    Text(localizer.text("parcel.sender", ["sender": sender]))
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.caption2.weight(.light)).foregroundStyle(.secondary).accessibilityHidden(true)
        }
        .padding(13).frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
        .background(Brand.warning.opacity(0.06), in: RoundedRectangle(cornerRadius: 13))
        .overlay { RoundedRectangle(cornerRadius: 13).stroke(Brand.warning.opacity(0.18), lineWidth: 0.75) }
        .matchedTransitionSource(id: parcel.id, in: transition)
        .experimentalSwipeToArchive(title: localizer.text("parcel.archive"), cornerRadius: 13, shadow: false, onOpen: onOpen, action: onArchive)
        .accessibilityElement(children: .combine)
        .accessibilityHint(localizer.text("detail.label"))
    }
}

private struct ExperimentalNextDeliveryPass: View {
    let parcel: Parcel
    let transition: Namespace.ID
    let onOpen: () -> Void
    let onArchive: () async -> Void

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    @ObservedObject private var catalog = CarrierCatalog.shared

    private var identity: CarrierVisualIdentity {
        CarrierVisualIdentity(id: parcel.activeTrackingCarrier.rawValue,
            carrier: catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language))
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

            if let sender = parcel.carrierData?.senderName?.nonEmpty {
                Text(localizer.text("parcel.sender", ["sender": sender]))
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 5)
            }

            Text([localizer.parcelStatus(parcel), localizer.parcelDeliveryEstimate(parcel)]
                .compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(identity.ink)
                .fixedSize(horizontal: false, vertical: true)
            if parcel.syncStatus == .error {
                Text(localizer.text("parcel.syncAttention"))
                    .font(.caption)
                    .foregroundStyle(Brand.warning)
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
    let onArchive: (() async -> Void)?

    @EnvironmentObject private var localizer: Localizer
    @ObservedObject private var catalog = CarrierCatalog.shared

    private var identity: CarrierVisualIdentity {
        CarrierVisualIdentity(id: parcel.activeTrackingCarrier.rawValue,
            carrier: catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language))
    }
    private var date: String? { localizer.parcelDeliveryEstimate(parcel) ?? localizer.parcelCompletionDate(parcel) }

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
            if let sender = parcel.carrierData?.senderName?.nonEmpty {
                Text(localizer.text("parcel.sender", ["sender": sender]))
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 5) {
                if parcel.isDelivered { Image(systemName: "checkmark").font(.caption2.weight(.light)).accessibilityHidden(true) }
                Text(localizer.parcelStatus(parcel))
            }
                .font(.caption)
                .foregroundStyle(identity.ink)
                .fixedSize(horizontal: false, vertical: true)
            if parcel.syncStatus == .error {
                Text(localizer.text("parcel.syncAttention"))
                    .font(.caption).foregroundStyle(Brand.warning)
            } else if let notice, parcel.currentStage != .customs,
                      parcel.currentStage != .readyForPickup, parcel.currentStage != .failedAttempt {
                Text(notice).font(.caption).foregroundStyle(Brand.warning)
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

private struct ExperimentalDeliveredParcelCard: View {
    let parcel: Parcel
    let transition: Namespace.ID
    let onOpen: () -> Void
    let onArchive: (() async -> Void)?

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
        action: (() async -> Void)?
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

/// The displayed offset survives gesture release and cancellation until settling.
struct ArchiveSwipeState {
    enum Destination: Equatable { case closed, revealed, archive }
    static let actionWidth: CGFloat = 88
    private(set) var offset: CGFloat = 0
    private var origin: CGFloat?
    private var horizontal = false

    static func commitThreshold(width: CGFloat) -> CGFloat {
        max(actionWidth * 1.75, width * 0.52)
    }

    mutating func drag(translation: CGSize, width: CGFloat) {
        if origin == nil {
            origin = offset
            horizontal = abs(translation.width) > abs(translation.height)
        }
        guard horizontal, let origin else { return }
        offset = max(-max(width, Self.actionWidth), min(0, origin + translation.width))
    }

    mutating func release(predictedTranslation: CGFloat, width: CGFloat) -> Destination? {
        defer { origin = nil; horizontal = false }
        guard horizontal, let origin else { return nil }
        if offset <= -Self.commitThreshold(width: width) { return .archive }
        return origin + predictedTranslation < -Self.actionWidth * 0.42 ? .revealed : .closed
    }

    mutating func cancel() -> Destination? {
        defer { origin = nil; horizontal = false }
        guard horizontal, origin != nil else { return nil }
        return offset < -Self.actionWidth / 2 ? .revealed : .closed
    }

    mutating func settle(at offset: CGFloat) {
        self.offset = offset
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

private struct ArchivePanGesture: UIGestureRecognizerRepresentable {
    let onChanged: (CGSize) -> Void
    let onEnded: (CGFloat) -> Void
    let onCancelled: () -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> ArchivePanGestureDelegate {
        ArchivePanGestureDelegate()
    }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let recognizer = UIPanGestureRecognizer()
        recognizer.maximumNumberOfTouches = 1
        recognizer.delegate = context.coordinator
        return recognizer
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        let translation = context.converter.localTranslation ?? recognizer.translation(in: recognizer.view)
        switch recognizer.state {
        case .began, .changed:
            onChanged(CGSize(width: translation.x, height: translation.y))
        case .ended:
            let velocity = context.converter.localVelocity ?? recognizer.velocity(in: recognizer.view)
            // A short flick can reveal the action; archiving still needs actual travel.
            onEnded(translation.x + velocity.x * 0.15)
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
    let action: (() async -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var gestureActive = false
    @State private var swipe = ArchiveSwipeState()
    @State private var committing = false
    @State private var width: CGFloat = 0
    @State private var archiveFeedback = 0

    private let actionWidth = ArchiveSwipeState.actionWidth

    @ViewBuilder
    func body(content: Content) -> some View {
        if let action {
            ZStack(alignment: .trailing) {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Brand.warning)
                    .overlay(alignment: .trailing) {
                        Button {
                            trigger(action, provideFeedback: true)
                        } label: {
                            Label(title, systemImage: "archivebox.fill")
                                .labelStyle(.iconOnly)
                                .font(.system(size: 18, weight: .bold))
                                .scaleEffect(archiveIconScale)
                                .symbolEffect(.bounce, value: isCommitArmed && !reduceMotion)
                                .animation(
                                    reduceMotion
                                        ? nil
                                        : .snappy(duration: 0.22, extraBounce: 0.16),
                                    value: isCommitArmed
                                )
                                .foregroundStyle(Brand.color(light: "#FFFFFF", dark: "#292820"))
                                .frame(width: max(actionWidth, revealedWidth))
                                .frame(maxHeight: .infinity)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .allowsHitTesting(revealedWidth >= 8)
                        .accessibilityHidden(revealedWidth < 8)
                    }
                    .opacity(revealProgress)

                content
                    .offset(x: currentOffset)
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .shadow(
                color: shadow ? .black.opacity(0.035) : .clear,
                radius: shadow ? 10 : 0,
                y: shadow ? 4 : 0
            )
            .contentShape(Rectangle())
            .onGeometryChange(for: CGFloat.self) { geometry in
                geometry.size.width
            } action: { nextWidth in
                width = nextWidth
            }
            .simultaneousGesture(tapGesture, including: .gesture)
            .gesture(swipeGesture(action: action))
            .onDisappear(perform: cancelSwipe)
            .allowsHitTesting(!committing)
            .sensoryFeedback(
                .impact(weight: .medium, intensity: 0.9),
                trigger: isCommitArmed
            ) { wasArmed, isArmed in
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

    private var currentOffset: CGFloat {
        swipe.offset
    }

    private var revealProgress: CGFloat {
        min(1, max(0, -currentOffset / actionWidth))
    }

    private var revealedWidth: CGFloat {
        max(0, -currentOffset)
    }

    private var commitThreshold: CGFloat {
        ArchiveSwipeState.commitThreshold(width: width)
    }

    private var isCommitArmed: Bool {
        gestureActive && !committing && width > 0 && revealedWidth >= commitThreshold
    }

    private var archiveIconScale: CGFloat {
        let revealScale = 0.76 + (revealProgress * 0.24)
        return revealScale * (isCommitArmed && !reduceMotion ? 1.22 : 1)
    }

    private var tapGesture: some Gesture {
        SpatialTapGesture()
            .onEnded { value in
                handleTap(at: value.location)
            }
    }

    private func swipeGesture(action: @escaping () async -> Void) -> ArchivePanGesture {
        ArchivePanGesture(
            onChanged: { translation in
                guard !committing else { return }
                var transaction = Transaction(animation: nil)
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    gestureActive = true
                    swipe.drag(translation: translation, width: width)
                }
            },
            onEnded: { predictedTranslation in
                gestureActive = false
                guard !committing, let destination = swipe.release(
                    predictedTranslation: predictedTranslation,
                    width: width
                ) else { return }
                if destination == .archive {
                    trigger(action, provideFeedback: false)
                } else {
                    settle(destination)
                }
            },
            onCancelled: cancelSwipe
        )
    }

    private func cancelSwipe() {
        gestureActive = false
        guard !committing, let destination = swipe.cancel() else { return }
        settle(destination)
    }

    private func settle(_ destination: ArchiveSwipeState.Destination) {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.26)) {
            swipe.settle(at: destination == .revealed ? -actionWidth : 0)
        }
    }

    private func handleTap(at location: CGPoint) {
        guard !committing else { return }
        if currentOffset < -1 {
            guard location.x < width - revealedWidth else { return }
            settle(.closed)
            return
        }
        onOpen()
    }

    private func trigger(_ action: @escaping () async -> Void, provideFeedback: Bool) {
        guard !committing else { return }
        committing = true
        if provideFeedback { archiveFeedback += 1 }
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.24)) {
            swipe.settle(at: -max(width, actionWidth))
        } completion: {
            Task { @MainActor in
                await action()
                // The row normally disappears. If the request failed, return it
                // only after the result, rather than on an arbitrary timer.
                committing = false
                settle(.closed)
            }
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
