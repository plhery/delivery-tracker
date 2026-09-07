import SwiftUI
import UIKit

struct ParcelListView: View {
    @EnvironmentObject private var localizer: Localizer
    @State private var selection = 0

    var body: some View {
        TabView(selection: $selection) {
            DeliveryListView()
                .tag(0)
                .tabItem {
                    Label(localizer.text("native.deliveries"), systemImage: "shippingbox.fill")
                }

            PassportView()
                .tag(1)
                .tabItem {
                    Label(ExperimentalCopy(language: localizer.language).passport, systemImage: "book.closed.fill")
                }
        }
        .tint(Brand.ink)
        .sensoryFeedback(.selection, trigger: selection)
    }
}

struct DemoModeBar: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        if session.isDemo {
            Button {
                session.showSignIn()
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
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Namespace private var parcelTransition
    @State private var path: [UUID] = []
    @State private var query = ""
    @State private var statusFilter: ParcelStatusFilter = .all
    @State private var carrierFilter: CarrierID?
    @State private var sort: ParcelSort = .priority
    @State private var showingFilters = false
    @State private var showingAdd = false
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
            .searchable(text: $query, prompt: localizer.text("view.searchPlaceholder"))
            .navigationDestination(for: UUID.self) { parcelID in
                ParcelDetailView(parcelID: parcelID, transition: parcelTransition)
                    .safeAreaInset(edge: .top, spacing: 0) { DemoModeBar() }
            }
            .safeAreaInset(edge: .bottom, spacing: 8) { bottomControls }
        }
        .sheet(isPresented: $showingAdd) {
            AddParcelView(draft: sharedDraft) { parcelID in
                showingAdd = false
                path = [parcelID]
            }
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
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            consumeSharedDraft()
        }
        .onReceive(NotificationCenter.default.publisher(for: .didOpenParcelNotification)) { notification in
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
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                listOverview

                if !hasCustomView, let nextParcel {
                    ExperimentalNextDeliveryPass(
                        parcel: nextParcel,
                        transition: parcelTransition,
                        onOpen: { path.append(nextParcel.id) },
                        onArchive: { await archive(nextParcel) }
                    )
                    .id(nextParcel.id)
                }

                if let message = store.errorMessage {
                    NoticeBanner(
                        symbol: "wifi.exclamationmark",
                        title: localizer.text(store.authenticationRequired ? "app.signInNeeded" : "app.trackingBreak"),
                        message: store.usingCachedData
                            ? "\(message) \(localizer.text("app.cachedData"))"
                            : message,
                        tint: Brand.warning,
                        actionTitle: localizer.text(store.authenticationRequired ? "app.signInAgain" : "app.tryAgain"),
                        action: { Task { await store.load(showSpinner: true) } }
                    )
                }

                if hasCustomView { filterChips }

                if !store.loading && store.parcels.isEmpty {
                    ContentUnavailableView(
                        localizer.text("app.emptyTitle"),
                        systemImage: "shippingbox",
                        description: Text(localizer.text("app.emptyDescription"))
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 52)
                } else if !store.loading && visibleParcels.isEmpty {
                    ContentUnavailableView {
                        Label(localizer.text("view.noResultsTitle"), systemImage: "line.3.horizontal.decrease.circle")
                    } description: {
                        Text(localizer.text("view.noResultsDescription"))
                    } actions: {
                        Button(localizer.text("view.clear")) { clearFilters() }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
                }

                ForEach(sections) { section in
                    sectionContent(section)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 28)
            .animation(reduceMotion ? nil : .snappy(duration: 0.32), value: store.parcels.filter { !$0.isArchived }.map(\.id))
        }
        .scrollIndicators(.hidden)
        .refreshable {
            do {
                try await store.refreshAll()
                actionMessage = localizer.text("app.refreshQueued")
            } catch {
                actionError = localizer.errorMessage(error)
            }
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
        HStack(alignment: .center, spacing: 12) {
            HStack(spacing: 7) {
                Circle()
                    .fill(ExperimentalPalette.transit)
                    .frame(width: 6, height: 6)
                Text("\(store.parcels.filter(\.isActive).count)")
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text(ExperimentalCopy(language: localizer.language).active)
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline)
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            Button { showingFilters = true } label: {
                Image(systemName: hasCustomView
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease")
                    .font(.body.weight(.medium))
                    .foregroundStyle(hasCustomView ? ExperimentalPalette.transit : Brand.ink)
                    .frame(width: 44, height: 44)
                    .background(hasCustomView ? ExperimentalPalette.transit.opacity(0.09) : .clear, in: Circle())
            }
            .buttonStyle(ExperimentalLiftButtonStyle())
            .accessibilityLabel(localizer.text("view.showControls"))
        }
        .padding(.leading, 4)
        .padding(.bottom, -12)
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
        }
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

    private var sections: [ParcelSection] {
        let organized = ParcelOrganizer.sections(from: visibleParcels)
        guard !hasCustomView, let highlighted = nextParcel?.id else { return organized }
        return organized.compactMap { section in
            let remaining = section.parcels.filter { $0.id != highlighted }
            return remaining.isEmpty ? nil : ParcelSection(kind: section.kind, parcels: remaining)
        }
    }

    private var availableCarriers: [CarrierID] {
        Array(Set(store.parcels.map(\.carrier))).sorted {
            catalog.info(for: $0, language: localizer.language).displayName < catalog.info(for: $1, language: localizer.language).displayName
        }
    }

    private var nextParcel: Parcel? {
        ParcelOrganizer.visible(
            store.parcels,
            query: "",
            status: .active,
            carrier: nil,
            sort: .priority,
            catalog: catalog
        ).first
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
                .font(.title3.weight(.bold))
            Text("\(section.parcels.count)")
                .font(.caption2.weight(.bold).monospacedDigit())
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .frame(height: 24)
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
                    ExperimentalParcelPassCard(
                        parcel: parcel,
                        notice: section.kind == .attention
                            ? parcel.attention().map { localizer.text($0.localizationKey) }
                            : nil,
                        transition: parcelTransition,
                        onOpen: { path.append(parcel.id) },
                        onArchive: parcel.isArchived ? nil : { await archive(parcel) }
                    )
                }
            }
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
    let onArchive: () async -> Void

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    @ObservedObject private var catalog = CarrierCatalog.shared

    var body: some View {
        let tint = Brand.onAccent
        let deliveryDate = localizer.parcelCompletionDate(parcel) ?? localizer.parcelDeliveryEstimate(parcel)

        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 8) {
                Text(localizer.text("app.nextUp"))
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .tracking(1.2)
                    .foregroundStyle(Brand.onAccent.opacity(0.75))
                Spacer(minLength: 8)
                HStack(spacing: 5) {
                    Circle().fill(tint).frame(width: 5, height: 5)
                    Text(localizer.parcelStatus(parcel))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Brand.onAccent)
                }
                .padding(.horizontal, 9)
                .padding(.vertical, 6)
                .background(.white.opacity(0.36), in: Capsule())
            }

            HStack(alignment: .center, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    if let date = deliveryDate {
                        Text(date)
                            .font(.system(.largeTitle, design: .default, weight: .semibold))
                            .tracking(-1.0)
                            .contentTransition(.numericText())
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                        .font((deliveryDate == nil ? Font.title2 : Font.headline).weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                DeliveryPostageStamp(stage: parcel.currentStage, appeared: appeared)
            }

            ExperimentalJourneyRail(stage: parcel.currentStage, tint: tint)
                .environmentObject(localizer)

            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language).displayName)
                        .font(.subheadline.weight(.semibold))
                    if let location = parcel.experimentalLatestLocation {
                        Text(location)
                            .font(.caption)
                            .foregroundStyle(Brand.onAccent.opacity(0.75))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Brand.onAccent.opacity(0.7))
            }
            .padding(.top, 2)
        }
        .foregroundStyle(Brand.onAccent)
        .padding(20)
        .experimentalSurface(fill: Brand.accent, cornerRadius: 24)
        .matchedTransitionSource(id: parcel.id, in: transition)
        .accessibilityElement(children: .combine)
        .experimentalSwipeToArchive(
            title: localizer.text("parcel.archive"),
            cornerRadius: 24,
            onOpen: onOpen,
            action: onArchive
        )
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 6)
        .accessibilityHint(localizer.text("detail.label"))
        .onAppear {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.3)) {
                appeared = true
            }
        }
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

    var body: some View {
        let tint = ExperimentalPalette.tint(for: parcel)

        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                    Spacer(minLength: 4)
                    Text(localizer.parcelStatus(parcel))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(tint)
                        .lineLimit(1)
                }

                HStack(spacing: 6) {
                    Text(catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language).displayName)
                    if let expected = localizer.parcelDeliveryEstimate(parcel) {
                        Text("·")
                            .foregroundStyle(.tertiary)
                        Text(expected)
                    } else if let completed = localizer.parcelCompletionDate(parcel) {
                        Text("·")
                            .foregroundStyle(.tertiary)
                        Text(completed)
                    }
                    if let place = parcel.experimentalLatestLocation {
                        Text("·")
                            .foregroundStyle(.tertiary)
                        Text(place)
                            .lineLimit(1)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

                if let notice {
                    Label(notice, systemImage: "exclamationmark.circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Brand.warning)
                        .lineLimit(2)
                }

                if parcel.currentStage?.isFinal != true {
                    ExperimentalJourneyRail(stage: parcel.currentStage, tint: tint, compact: true)
                        .environmentObject(localizer)
                }
            }
            .padding(.vertical, 14)
            .padding(.leading, 15)
            .padding(.trailing, onArchive == nil ? 15 : 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())

            if let onArchive {
                Menu {
                    Button(localizer.text("parcel.archive"), systemImage: "archivebox") {
                        Task { await onArchive() }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.bold))
                        .foregroundStyle(.secondary)
                        .frame(width: 40, height: 50)
                }
                .accessibilityLabel(localizer.text("parcel.actionsAria", [
                    "name": parcel.label.nonEmpty ?? localizer.text("common.parcel"),
                ]))
            }
        }
        .experimentalSurface(fill: ExperimentalPalette.surface(for: parcel), cornerRadius: 18, shadow: false)
        .matchedTransitionSource(id: parcel.id, in: transition)
        .experimentalSwipeToArchive(
            title: localizer.text("parcel.archive"),
            cornerRadius: 18,
            shadow: false,
            protectedTrailingWidth: onArchive == nil ? 0 : 40,
            onOpen: onOpen,
            action: onArchive
        )
        .accessibilityElement(children: .contain)
    }
}

private struct ExperimentalDeliveredParcelCard: View {
    let parcel: Parcel
    let transition: Namespace.ID
    let onOpen: () -> Void
    let onArchive: (() async -> Void)?

    @EnvironmentObject private var localizer: Localizer
    @ObservedObject private var catalog = CarrierCatalog.shared

    var body: some View {
        let tint = ExperimentalPalette.delivered

        HStack(spacing: 0) {
            HStack(spacing: 11) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(tint)
                    .frame(width: 30)

                VStack(alignment: .leading, spacing: 3) {
                    Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    Text(catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language).displayName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 4)

                if let date = parcel.experimentalCompletionDate {
                    Text(localizer.shortDate(date))
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.vertical, 13)
            .padding(.leading, 15)
            .padding(.trailing, onArchive == nil ? 15 : 3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())

            if let onArchive {
                Menu {
                    Button(localizer.text("parcel.archive"), systemImage: "archivebox") {
                        Task { await onArchive() }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.bold))
                        .foregroundStyle(.secondary)
                        .frame(width: 38, height: 54)
                }
                .accessibilityLabel(localizer.text("parcel.actionsAria", [
                    "name": parcel.label.nonEmpty ?? localizer.text("common.parcel"),
                ]))
            }
        }
        .experimentalSurface(fill: ExperimentalPalette.surface(for: parcel), cornerRadius: 18, shadow: false)
        .matchedTransitionSource(id: parcel.id, in: transition)
        .experimentalSwipeToArchive(
            title: localizer.text("parcel.archive"),
            cornerRadius: 18,
            shadow: false,
            protectedTrailingWidth: onArchive == nil ? 0 : 38,
            onOpen: onOpen,
            action: onArchive
        )
        .accessibilityElement(children: .contain)
    }
}

private extension View {
    func experimentalSwipeToArchive(
        title: String,
        cornerRadius: CGFloat,
        shadow: Bool = true,
        protectedTrailingWidth: CGFloat = 0,
        onOpen: @escaping () -> Void,
        action: (() async -> Void)?
    ) -> some View {
        modifier(ExperimentalSwipeToArchiveModifier(
            title: title,
            cornerRadius: cornerRadius,
            shadow: shadow,
            protectedTrailingWidth: protectedTrailingWidth,
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
    let protectedTrailingWidth: CGFloat
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
        guard location.x < width - protectedTrailingWidth else { return }
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
        let copy = ExperimentalCopy(language: localizer.language)

        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.3, extraBounce: 0.02)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "archivebox.fill")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(width: 22)

                    Text(localizer.text("app.archived"))
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(.primary)

                    Spacer(minLength: 6)

                    CountPill(count: parcels.count)

                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .padding(.vertical, 9)
                .padding(.horizontal, 2)
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
