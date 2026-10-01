import SwiftUI
import UIKit

struct ParcelDetailView: View {
    let parcelID: UUID
    let transition: Namespace.ID

    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL

    @State private var showingFullJourney = true
    @State private var showingTitleEditor = false
    @State private var editedTitle = ""
    @State private var copiedNumber: String?
    @State private var copiedPickupPoint = false
    @State private var working = false
    @State private var errorMessage: String?
    @State private var carrierEditor: CarrierEditorRequest?
    @State private var showingDeleteConfirmation = false
    @State private var notificationAnimation = 0
    @State private var showingMap = false
    @State private var atlas: WorldAtlas?

    @ObservedObject private var catalog = CarrierCatalog.shared

    var body: some View {
        ZStack {
            ExperimentalBackdrop()
            if let parcel {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        liveParcelPass(parcel)
                        if catalog.tracksAutomatically(parcel.activeTrackingCarrier) || parcel.hasCarrierUpdate {
                            journey(parcel)
                        }
                        syncStatus(parcel, tint: identity(parcel).ink)
                    }
                    .padding(18)
                    .background(Brand.paper, in: RoundedRectangle(cornerRadius: 26))
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 36)
                }
                .scrollIndicators(.hidden)
            } else {
                ContentUnavailableView(
                    localizer.text("common.parcel"),
                    systemImage: "shippingbox",
                    description: Text(localizer.text("native.parcelMissing"))
                )
            }
        }
        .navigationTitle(localizer.text("detail.label"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationTransition(.zoom(sourceID: parcelID, in: transition))
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            if let parcel {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(localizer.text("detail.editTitle"), systemImage: "pencil") {
                            editedTitle = parcel.label
                            showingTitleEditor = true
                        }
                        Button(localizer.text("detail.copyTracking"), systemImage: "doc.on.doc") {
                            let entry = parcel.trackingNumbers[0]
                            copy(entry.number, carrier: entry.carrier)
                        }
                        Button(localizer.text("detail.changeCarrier"), systemImage: "truck.box") {
                            carrierEditor = CarrierEditorRequest()
                        }
                        Divider()
                        if parcel.isArchived {
                            Button(localizer.text("detail.restore"), systemImage: "arrow.uturn.backward") {
                                restore(parcel)
                            }
                        } else {
                            Button(localizer.text("detail.archive"), systemImage: "archivebox") {
                                archive(parcel)
                            }
                        }
                        Divider()
                        Button {
                            showingDeleteConfirmation = true
                        } label: {
                            Label(localizer.text("detail.delete"), systemImage: "trash")
                        }
                        .disabled(working)
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                }
            }
        }
        .alert(localizer.text("native.errorTitle"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(localizer.text("common.close"), role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .task(id: needsMap) {
            guard needsMap, atlas == nil else { return }
            let loaded = await WorldAtlas.bundled.value
            withAnimation(.easeOut(duration: 0.5)) { atlas = loaded }
        }
        .fullScreenCover(isPresented: $showingMap) {
            if let parcel, let atlas {
                ParcelMapScreen(
                    atlas: atlas, route: ParcelRoute(parcel: parcel, atlas: atlas, language: localizer.language),
                    stage: parcel.currentStage, accent: identity(parcel).ink
                )
                .environmentObject(localizer)
            }
        }
        .sheet(item: $carrierEditor) { request in
            if let parcel {
                ChangeCarrierView(parcel: parcel, initialCarrier: request.initialCarrier)
                    .environmentObject(store)
                    .environmentObject(localizer)
            }
        }
        .alert(localizer.text("detail.editTitle"), isPresented: $showingTitleEditor) {
            TextField(localizer.text("common.parcel"), text: $editedTitle)
            Button(localizer.text("common.cancel"), role: .cancel) {}
            Button(localizer.text("detail.saveTitle")) {
                if let parcel {
                    let label = String(editedTitle.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
                    run { try await store.rename(parcel, label: label) }
                }
            }
        }
        .confirmationDialog(
            localizer.text("detail.deleteQuestion"),
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button(localizer.text("detail.delete")) {
                if let parcel { delete(parcel) }
            }
            Button(localizer.text("common.cancel"), role: .cancel) {}
        } message: {
            Text(localizer.text("detail.deleteDescription"))
        }
    }

    private var parcel: Parcel? { store.parcels.first { $0.id == parcelID || $0.carrierData?.originalPackageID == parcelID } }

    /// A scan has a place, so the card shows the route once the map data has loaded.
    private var needsMap: Bool { parcel?.trackingEvents.contains { $0.place != nil } ?? false }

    private func openMap() {
        DeliveryAnalytics.shared.action("parcel-map-open")
        showingMap = true
    }

    private func identity(_ parcel: Parcel) -> CarrierVisualIdentity {
        CarrierVisualIdentity.of(parcel.displayedCarrier, catalog: catalog, language: localizer.language)
    }

    private func liveParcelPass(_ parcel: Parcel) -> some View {
        let branding = identity(parcel)
        let carrier = catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language)
        let trackingLinks = catalog.trackingLinks(for: parcel, language: localizer.language)
        let placed = parcel.trackingEvents.contains { $0.place != nil }
        let route = placed ? atlas.map { ParcelRoute(parcel: parcel, atlas: $0, language: localizer.language) } : nil

        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Button { carrierEditor = CarrierEditorRequest() } label: {
                        CarrierFleetMark(identity: branding)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(localizer.text("detail.changeCarrierFrom", ["carrier": carrier.displayName]))
                    Spacer(minLength: 8)
                    if placed {
                        Button(action: openMap) {
                            Image(systemName: "globe")
                                .font(.system(size: 17))
                                .frame(width: 44, height: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(branding.ink.opacity(0.75))
                        .disabled(route == nil)
                        .accessibilityLabel(localizer.text("map.open"))
                    }
                    Button {
                        run {
                            try await store.setMuted(parcel, muted: !parcel.notificationsMuted)
                            notificationAnimation += 1
                            UISelectionFeedbackGenerator().selectionChanged()
                        }
                    } label: {
                        ParcelNotificationBell(muted: parcel.notificationsMuted, trigger: notificationAnimation)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(branding.ink.opacity(0.75))
                    .disabled(working)
                    .accessibilityLabel(localizer.text(parcel.notificationsMuted ? "detail.unmute" : "detail.mute"))
                }
                if placed {
                    // Room for the route engraved behind this part of the card.
                    Color.clear.frame(height: 68).allowsHitTesting(false)
                }
                AutomaticCarrierNotice(parcel: parcel)
                if let needed = parcel.inputNeededPrompt {
                    inputNeededPrompt(needed, tint: branding.ink)
                }
                HStack(alignment: .center, spacing: 18) {
                    Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                        .font(.title2.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    DeliveryPostageStamp(parcel: parcel, identity: branding, width: 50, appeared: true)
                }
                if let sender = parcel.carrierData?.senderName?.nonEmpty {
                    Text(localizer.text("parcel.sender", ["sender": sender]))
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if parcel.carrier == .dpd, let postcode = parcel.dpdPostcode?.nonEmpty,
                   parcel.carrierData?.dpdPostcodeVerified == false {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(localizer.text("detail.postcodeNotVerified", ["carrier": carrier.displayName, "postcode": postcode]))
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        if parcel.archivedAt == nil {
                            Button(localizer.text("detail.editPostcode")) { carrierEditor = CarrierEditorRequest() }
                                .font(.caption.weight(.semibold))
                        }
                    }
                }
                if trackingLinks.count > 1 { trackingSources(trackingLinks, tint: branding.ink) }
                VStack(alignment: .leading, spacing: 6) {
                    Text(localizer.parcelStatus(parcel))
                        .font(.subheadline)
                    if let date = localizer.parcelCompletionDate(parcel) ?? localizer.parcelDeliveryEstimate(parcel) {
                        Text(date).font(.caption)
                    }
                }
                .foregroundStyle(branding.ink)
                .fixedSize(horizontal: false, vertical: true)
                ExperimentalJourneyRail(stage: parcel.currentStage, tint: branding.ink.opacity(0.45), compact: true)
            }
            .padding(18)
            .background(alignment: .top) {
                if let atlas, let route {
                    // The title is written over the bottom of the map, so Pip stays above it.
                    RouteEngraving(atlas: atlas, route: route, stage: parcel.currentStage, identity: branding, floor: 160)
                        .frame(height: 176)
                        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18))
                        .contentShape(Rectangle())
                        .onTapGesture(perform: openMap)
                        .transition(.opacity)
                }
            }
            .background(branding.surface, in: RoundedRectangle(cornerRadius: 18))

            // While the parcel waits, its pickup point gets a card; afterwards it is a plain fact.
            let waitingAt = parcel.currentStage == .readyForPickup ? PickupPoint(parcel.carrierData?.pickupPoint) : nil
            if let waitingAt {
                pickupPointCard(waitingAt, identity: branding)
            }
            shipmentIdentity(parcel, links: trackingLinks, tint: branding.ink)
            if let details = parcel.carrierData {
                VStack(alignment: .leading, spacing: 10) {
                    if waitingAt == nil, let value = details.pickupPoint?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
                        shipmentFact(parcel.currentStage == .delivered ? "detail.collectedAt" : "detail.pickupPoint", value: value)
                    }
                    if let value = details.receiverName?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
                        shipmentFact("detail.recipient", value: value)
                    }
                    if let weight = details.weightKg, weight.isFinite, weight > 0 {
                        shipmentFact("detail.weight", value: weight.formatted(.number.locale(localizer.language.locale).precision(.fractionLength(0...3))) + " kg")
                    }
                    if let value = details.dimensionsText?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
                        shipmentFact("detail.dimensions", value: value)
                    }
                }
            }
            if !catalog.tracksAutomatically(parcel.activeTrackingCarrier) || parcel.amazonShippingHistoryExpired {
                VStack(alignment: .leading, spacing: 10) {
                    Text(localizer.text(parcel.amazonShippingHistoryExpired ? "add.amazonHistoryExpired" : catalog.trackingHintKey(for: parcel.activeTrackingCarrier), ["carrier": carrier.displayName]))
                        .font(.footnote).foregroundStyle(.secondary)
                    if !catalog.requiresAmazonAccount(parcel.activeTrackingCarrier) && !parcel.amazonShippingHistoryExpired {
                        Button(localizer.text("detail.changeCarrier")) { carrierEditor = CarrierEditorRequest() }
                            .font(.footnote).foregroundStyle(branding.ink)
                    }
                }
            } else if let error = parcel.syncError {
                Text(localizer.trackingFailureMessage(error))
                    .font(.footnote).foregroundStyle(Brand.warning)
                if error == "carrier:input_required", parcel.activeTrackingCarrier == parcel.carrier,
                   !catalog.requirements(for: parcel.carrier, trackingNumber: parcel.trackingNumber).isEmpty {
                    Button(localizer.text("detail.updateTrackingDetails")) { carrierEditor = CarrierEditorRequest() }
                        .font(.footnote).foregroundStyle(branding.ink)
                }
            }
            Divider()
        }
        .accessibilityElement(children: .contain)
    }

    /// Recognition found the carrier, but it needs the postcode before it can track.
    private func inputNeededPrompt(_ needed: CarrierInputNeeded, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(localizer.text("detail.inputNeeded", [
                "carrier": catalog.info(for: needed.carrier, language: localizer.language).displayName,
            ]))
            .font(.footnote)
            .fixedSize(horizontal: false, vertical: true)
            Button {
                carrierEditor = CarrierEditorRequest(initialCarrier: needed.carrier)
            } label: {
                Text(localizer.text("detail.inputNeededAction"))
                    .font(.footnote.weight(.semibold))
                    .frame(minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(TactileButtonStyle())
        }
        .foregroundStyle(tint)
        .accessibilityElement(children: .contain)
    }

    /// Where the parcel waits for collection, with a way to get there.
    private func pickupPointCard(_ point: PickupPoint, identity: CarrierVisualIdentity) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "storefront")
                    .font(.system(size: 17))
                    .foregroundStyle(identity.ink)
                    .frame(width: 40, height: 40)
                    .background(identity.surface, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(localizer.text("detail.pickupPoint")).font(.caption).foregroundStyle(.secondary)
                    Text(point.name).font(.callout.weight(.semibold))
                    if let address = point.address {
                        Text(address).font(.footnote)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .combine)
            }
            HStack(spacing: 8) {
                Button {
                    DeliveryAnalytics.shared.action("parcel-pickup-directions")
                    if let url = point.mapsURL { openURL(url) }
                } label: {
                    Label(localizer.text(point.address == nil ? "detail.pickupShowOnMap" : "detail.pickupDirections"),
                          systemImage: point.address == nil ? "magnifyingglass" : "location.fill")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .foregroundStyle(identity.surface)
                        .background(identity.ink, in: RoundedRectangle(cornerRadius: 12))
                        .contentShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(TactileButtonStyle())
                if point.address != nil {
                    Button { copyPickupPoint(point) } label: {
                        Label(localizer.text(copiedPickupPoint ? "detail.copied" : "detail.pickupCopyAddress"),
                              systemImage: copiedPickupPoint ? "checkmark" : "doc.on.doc")
                            .font(.subheadline)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .foregroundStyle(.primary)
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.secondary.opacity(0.3)))
                            .contentShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(TactileButtonStyle())
                }
            }
        }
        .padding(16)
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(identity.ink.opacity(0.18)))
        .accessibilityElement(children: .contain)
    }

    private func copyPickupPoint(_ point: PickupPoint) {
        DeliveryAnalytics.shared.action("parcel-pickup-copy", .success)
        UIPasteboard.general.string = point.query
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        copiedPickupPoint = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            copiedPickupPoint = false
        }
    }

    private func shipmentFact(_ key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(localizer.text(key)).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.footnote).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func shipmentIdentity(_ parcel: Parcel, links: [ParcelTrackingLink], tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(parcel.trackingNumbers, id: \.number) { entry in
                HStack(alignment: .center, spacing: 8) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(parcel.trackingNumbers.count > 1
                            ? catalog.info(for: entry.carrier, language: localizer.language).displayName
                            : localizer.text("detail.trackingNumber"))
                            .font(.caption2).foregroundStyle(.secondary)
                        Text(CarrierCatalog.format(entry.number, carrier: entry.carrier))
                            .font(.system(.caption, design: .monospaced))
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                    Spacer(minLength: 0)
                    Button { copy(entry.number, carrier: entry.carrier) } label: {
                        Image(systemName: copiedNumber == entry.number ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 14, weight: .regular))
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).foregroundStyle(.secondary)
                    .accessibilityLabel(localizer.text(copiedNumber == entry.number ? "detail.copied" : "detail.copyTracking")
                        + (parcel.trackingNumbers.count > 1 ? " — " + catalog.info(for: entry.carrier, language: localizer.language).displayName : ""))
                }
            }
            if links.count <= 1 { trackingSources(links, tint: tint) }
        }
        .padding(.horizontal, 2)
    }

    @ViewBuilder
    private func trackingSources(_ links: [ParcelTrackingLink], tint: Color) -> some View {
        if links.count > 1 {
            HStack(alignment: .top, spacing: 8) {
                ForEach(links) { link in
                    Link(destination: link.url) {
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(alignment: .top) {
                                Text(link.name).font(.caption.weight(.medium))
                                Spacer(minLength: 4)
                                Image(systemName: "arrow.up.right").font(.caption2)
                            }
                            Text(localizer.text(link.role == .active ? "detail.sourceActive" : link.role == .waiting ? "detail.sourceWaiting" : "detail.sourceHistory"))
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(10).frame(maxWidth: .infinity, minHeight: 58, alignment: .topLeading)
                        .background(tint.opacity(link.role == .active ? 0.07 : 0), in: RoundedRectangle(cornerRadius: 10))
                        .overlay { RoundedRectangle(cornerRadius: 10).stroke(tint.opacity(0.18), lineWidth: 0.75) }
                    }
                    .foregroundStyle(tint)
                    .accessibilityLabel(localizer.text("detail.carrierWebsite", ["carrier": link.name]))
                    .simultaneousGesture(TapGesture().onEnded { DeliveryAnalytics.shared.action("parcel-carrier-link") })
                }
            }
        } else {
            ForEach(links) { link in
                Link(destination: link.url) {
                    HStack(spacing: 6) {
                        Text(localizer.text("detail.carrierWebsite", ["carrier": link.name]))
                        Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .regular))
                        if link.role != .active {
                            Spacer(minLength: 4)
                            Text(localizer.text(link.role == .waiting ? "detail.sourceWaiting" : "detail.sourceHistory"))
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .font(.caption)
                    .padding(.vertical, 10)
                    .frame(minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.plain)
                .foregroundStyle(tint)
                .simultaneousGesture(TapGesture().onEnded { DeliveryAnalytics.shared.action("parcel-carrier-link") })
            }
        }
    }

    private func syncStatus(_ parcel: Parcel, tint: Color) -> some View {
        HStack(spacing: 7) {
            if let lastSyncedAt = parcel.lastSyncedAt {
                Text(localizer.text("detail.lastChecked", ["date": localizer.relativeTime(from: lastSyncedAt)]))
            }

            if !parcel.isArchived && catalog.tracksAutomatically(parcel.activeTrackingCarrier) {
                Button {
                    run { try await store.refresh(parcel) }
                } label: {
                    Group {
                        if working {
                            ProgressView()
                                .controlSize(.mini)
                        } else {
                            Image(systemName: "arrow.clockwise")
                                .font(.caption)
                        }
                    }
                    .frame(width: 26, height: 26)
                    .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(tint)
                .disabled(working)
                .accessibilityLabel(localizer.text("detail.checkNow"))
            }
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
    }

    private func journey(_ parcel: Parcel) -> some View {
        let groups = journalDays(parcel)
        let tint = identity(parcel).ink
        let eventCount = parcel.trackingEvents.count
        let currentEventID = parcel.currentEvent?.id
        let syncing = parcel.displayStatus.syncing
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { showingFullJourney.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Text(localizer.text("timeline.label")).font(.subheadline.weight(.semibold))
                    Spacer(minLength: 4)
                    Text(localizer.text(eventCount == 1 ? "detail.updateCount.one" : "detail.updateCount.many", ["count": eventCount]))
                        .font(.caption2).foregroundStyle(.secondary)
                    Image(systemName: showingFullJourney ? "chevron.up" : "chevron.down")
                        .font(.system(size: 10, weight: .regular)).foregroundStyle(.secondary)
                }
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(localizer.text(showingFullJourney ? "design.lessJourney" : "design.fullJourney"))
            if showingFullJourney {
                if groups.isEmpty {
                    Text(localizer.text(syncing ? "timeline.emptySyncing" : "timeline.empty"))
                        .font(.footnote).foregroundStyle(.secondary).padding(.vertical, 12)
                }
                ForEach(groups) { group in
                    Text(group.label)
                        .font(.caption2).textCase(.uppercase).tracking(1)
                        .foregroundStyle(.secondary).padding(.top, 22).padding(.bottom, 13)
                        .accessibilityAddTraits(.isHeader)
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(group.events) { event in
                            JournalEventRow(event: event, tint: tint,
                                isCurrent: event.id == currentEventID,
                                syncing: syncing)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 2)
    }

    private func journalDays(_ parcel: Parcel) -> [JournalDay] {
        var groups: [JournalDay] = []
        let calendar = Calendar.current
        for event in parcel.sortedEvents {
            let date = DateParser.date(event.occurredAt)
            let key = date.map { String(calendar.startOfDay(for: $0).timeIntervalSince1970) } ?? event.occurredAt
            if let index = groups.firstIndex(where: { $0.id == key }) {
                groups[index].events.append(event)
            } else {
                let label: String
                if let date {
                    if calendar.isDateInToday(date) { label = localizer.text("time.today") }
                    else if calendar.isDateInYesterday(date) { label = localizer.text("time.yesterday") }
                    else {
                        let year = calendar.component(.year, from: date)
                        label = localizer.shortDate(date) + (year == calendar.component(.year, from: Date()) ? "" : " \(year)")
                    }
                } else { label = event.occurredAt }
                groups.append(JournalDay(id: key, label: label, events: [event]))
            }
        }
        return groups
    }

    private func copy(_ value: String, carrier: CarrierID) {
        DeliveryAnalytics.shared.action("parcel-copy-tracking")
        UIPasteboard.general.string = carrier == .postlogistics
            ? CarrierCatalog.format(value, carrier: carrier) : value
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        copiedNumber = value
        Task {
            try? await Task.sleep(for: .seconds(2))
            if copiedNumber == value { copiedNumber = nil }
        }
    }

    private func archive(_ parcel: Parcel) {
        run {
            try await store.archive(parcel)
            dismiss()
        }
    }

    private func restore(_ parcel: Parcel) {
        run {
            try await store.restore(parcel)
            dismiss()
        }
    }

    private func delete(_ parcel: Parcel) {
        run {
            try await store.permanentlyDelete(parcel)
            dismiss()
        }
    }

    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !working else { return }
        working = true
        errorMessage = nil
        Task {
            do { try await operation() }
            catch { errorMessage = localizer.errorMessage(error) }
            working = false
        }
    }
}

private struct ParcelNotificationBell: View {
    let muted: Bool
    let trigger: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Pose {
        var angle = 0.0
        var scale = 1.0
        var waves = 0.0
    }

    var body: some View {
        let reduceMotion = self.reduceMotion
        return Color.clear
            .frame(width: 18, height: 18)
            .keyframeAnimator(initialValue: Pose(), trigger: trigger) { _, pose in
                ZStack {
                    Image(systemName: "bell")
                        .font(.system(size: 16, weight: .light))
                        .frame(width: 18, height: 18)
                        .rotationEffect(.degrees(reduceMotion ? 0 : pose.angle), anchor: UnitPoint(x: 0.5, y: 0.16))
                        .scaleEffect(reduceMotion ? 1 : pose.scale)
                    Path { path in
                        path.move(to: CGPoint(x: 2, y: 2))
                        path.addLine(to: CGPoint(x: 16, y: 16))
                    }
                    .trim(from: 0, to: muted ? 1 : 0)
                    .stroke(style: StrokeStyle(lineWidth: 1, lineCap: .round))
                    .opacity(muted ? 1 : 0)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: muted)
                    Path { path in
                        path.move(to: CGPoint(x: 0, y: 4))
                        path.addQuadCurve(to: CGPoint(x: 0, y: 11), control: CGPoint(x: -2, y: 7.5))
                        path.move(to: CGPoint(x: 18, y: 4))
                        path.addQuadCurve(to: CGPoint(x: 18, y: 11), control: CGPoint(x: 20, y: 7.5))
                    }
                    .stroke(style: StrokeStyle(lineWidth: 0.9, lineCap: .round))
                    .opacity(reduceMotion || muted ? 0 : pose.waves)
                }
                .frame(width: 18, height: 18)
            } keyframes: { _ in
                KeyframeTrack(\.angle) {
                    if muted {
                        CubicKeyframe(-7, duration: 0.112)
                        CubicKeyframe(3, duration: 0.112)
                        CubicKeyframe(0, duration: 0.096)
                    } else {
                        CubicKeyframe(17, duration: 0.115)
                        CubicKeyframe(-14, duration: 0.131)
                        CubicKeyframe(10, duration: 0.131)
                        CubicKeyframe(-6, duration: 0.131)
                        CubicKeyframe(3, duration: 0.132)
                        CubicKeyframe(0, duration: 0.18)
                    }
                }
                KeyframeTrack(\.scale) {
                    CubicKeyframe(muted ? 0.94 : 1, duration: 0.112)
                    CubicKeyframe(muted ? 1.02 : 1, duration: 0.112)
                    CubicKeyframe(1, duration: 0.096)
                }
                KeyframeTrack(\.waves) {
                    CubicKeyframe(muted ? 0 : 0.65, duration: 0.148)
                    CubicKeyframe(muted ? 0 : 0.15, duration: 0.114)
                    CubicKeyframe(muted ? 0 : 0.65, duration: 0.115)
                    CubicKeyframe(0, duration: 0.279)
                }
            }
            .accessibilityHidden(true)
    }
}

private struct ChangeCarrierView: View {
    let parcel: Parcel

    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss

    @State private var selectedCarrier: CarrierID
    @State private var trackingURL: String
    @State private var deliveryPostcode: String
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var detent: PresentationDetent = .medium

    @ObservedObject private var catalog = CarrierCatalog.shared

    /// `initialCarrier` preselects a carrier, such as one that recognized the number and needs a postcode.
    init(parcel: Parcel, initialCarrier: CarrierID? = nil) {
        self.parcel = parcel
        let carrier = initialCarrier ?? parcel.carrier
        _selectedCarrier = State(initialValue: carrier)
        _trackingURL = State(initialValue: carrier == parcel.carrier ? parcel.trackingURL ?? "" : "")
        _deliveryPostcode = State(initialValue: carrier == parcel.carrier ? parcel.dpdPostcode ?? "" : "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(CarrierCatalog.format(parcel.trackingNumber, carrier: parcel.carrier))
                        .font(.system(.body, design: .monospaced, weight: .semibold))
                    Text(localizer.text("detail.changeCarrierDescription", [
                        "number": CarrierCatalog.format(parcel.trackingNumber, carrier: parcel.carrier),
                    ]))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }

                Section(localizer.text("add.carrier")) {
                    NavigationLink {
                        CarrierPickerView(selection: selectedCarrier, sections: pickerSections) { carrier in
                            if let carrier { selectedCarrier = carrier }
                        }
                        // The full list, and room for its letter rail.
                        .onAppear { detent = .large }
                    } label: {
                        HStack(spacing: 10) {
                            CarrierTruckMark(identity: CarrierVisualIdentity.of(selectedCarrier, language: localizer.language))
                            Text(catalog.info(for: selectedCarrier, language: localizer.language).displayName)
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(localizer.text("add.carrier"))
                    .accessibilityValue(catalog.info(for: selectedCarrier, language: localizer.language).displayName)
                    .accessibilityAddTraits(.isButton)
                    .onChange(of: selectedCarrier) { _, carrier in
                        trackingURL = carrier == parcel.carrier ? parcel.trackingURL ?? "" : ""
                        deliveryPostcode = carrier == parcel.carrier ? parcel.dpdPostcode ?? "" : ""
                        errorMessage = nil
                    }
                    Text(localizer.text(catalog.trackingHintKey(for: selectedCarrier), [
                        "carrier": catalog.info(for: selectedCarrier, language: localizer.language).displayName,
                    ]))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }

                if !requirements.isEmpty {
                    Section {
                        ForEach(requirements, id: \.field) { requirement in
                            requirementField(requirement)
                        }
                    } footer: {
                        if postcodeRequirement?.isOptional == true {
                            Text(localizer.text("add.requirement.dpdPostcodeOptionalHelp", [
                                "carrier": catalog.info(for: selectedCarrier, language: localizer.language).displayName,
                            ]))
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(localizer.text("detail.changeCarrier"))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(saving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(localizer.text("common.cancel")) { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving
                        ? localizer.text("detail.changingCarrier")
                        : localizer.text("detail.saveCarrier")) {
                        save()
                    }
                    .fontWeight(.semibold)
                    .disabled(!canSave || saving)
                }
            }
        }
        // Inputs and their help sit below the half-height sheet: open fully for them.
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .onChange(of: requirements.isEmpty, initial: true) { _, empty in
            if !empty { detent = .large }
        }
    }

    private var requirements: [CarrierRequirement] {
        catalog.requirements(for: selectedCarrier, trackingNumber: parcel.trackingNumber)
    }

    /// The parcel's own carrier when no longer offered, then the carriers its
    /// number fits, then the ones used before.
    private var pickerSections: [CarrierPickerView.PickerSection] {
        let match = catalog.detect(parcel.trackingNumber)
        let fitting = (match.confidence == .high ? [match.carrier] : match.candidates)
            .filter { catalog.info(for: $0).selectable }
        return [
            .init(id: "current", title: localizer.text("picker.section.current"),
                  carriers: catalog.info(for: parcel.carrier).selectable ? [] : [parcel.carrier]),
            .init(id: "fits", title: localizer.text(match.confidence == .high ? "picker.section.detected" : "picker.section.fits"),
                  carriers: fitting),
            .init(id: "used", title: localizer.text("picker.section.used"),
                  carriers: CarrierPickerSearch.usedCarriers(store.parcels, catalog: catalog).filter { !fitting.contains($0) }),
        ]
    }

    private var trackingURLRequirement: CarrierRequirement? {
        requirements.first(where: { $0.field == .trackingURL })
    }

    private var postcodeRequirement: CarrierRequirement? {
        requirements.first(where: { $0.field == .dpdPostcode })
    }

    private var canSave: Bool {
        guard changed else { return false }
        for requirement in requirements {
            switch requirement.field {
            case .trackingURL:
                let value = requirement.normalizedValue(trackingURL)
                guard requirement.accepts(value),
                      let url = URL(string: value),
                      url.scheme == "https",
                      url.host != nil else { return false }
            case .dpdPostcode:
                guard requirement.isSatisfied(by: deliveryPostcode) else { return false }
            }
        }
        return true
    }

    private var changed: Bool {
        selectedCarrier != parcel.carrier
            || normalizedTrackingURL != (parcel.trackingURL ?? "")
            || normalizedPostcode != (parcel.dpdPostcode ?? "")
    }

    private var normalizedTrackingURL: String {
        guard let trackingURLRequirement else { return "" }
        return trackingURLRequirement.normalizedValue(trackingURL)
    }

    private var normalizedPostcode: String {
        guard let postcodeRequirement else { return "" }
        return postcodeRequirement.normalizedValue(deliveryPostcode)
    }

    @ViewBuilder
    private func requirementField(_ requirement: CarrierRequirement) -> some View {
        switch requirement.field {
        case .trackingURL:
            TextField(
                localizer.text("add.requirement.trackingUrl"),
                text: $trackingURL,
                axis: .vertical
            )
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        case .dpdPostcode:
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                TextField(
                    localizer.text("add.requirement.dpdPostcode"),
                    text: $deliveryPostcode
                )
                .keyboardType(requirement.inputMode == "numeric" ? .numberPad : .asciiCapable)
                .textContentType(.postalCode)
                .onChange(of: deliveryPostcode) { _, value in
                    deliveryPostcode = requirement.normalizedValue(value)
                }
                if requirement.isOptional {
                    Text(localizer.text("add.optional"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func save() {
        guard canSave, !saving else { return }
        saving = true
        errorMessage = nil
        Task {
            do {
                try await store.changeCarrier(
                    parcel,
                    carrier: selectedCarrier,
                    trackingURL: normalizedTrackingURL.nonEmpty,
                    dpdPostcode: normalizedPostcode.nonEmpty
                )
                dismiss()
            } catch {
                errorMessage = localizer.errorMessage(error)
                saving = false
            }
        }
    }
}

/// The carrier editor opens on a recognized carrier when a prompt asks for its input.
private struct CarrierEditorRequest: Identifiable {
    let id = UUID()
    var initialCarrier: CarrierID?
}

private struct JournalDay: Identifiable {
    let id: String
    let label: String
    var events: [TrackingEvent]
}

private struct JournalEventRow: View {
    let event: TrackingEvent
    let tint: Color
    let isCurrent: Bool
    let syncing: Bool
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(time)
                .font(.caption2).monospacedDigit()
                .foregroundStyle(isCurrent ? tint : Color.secondary)
                .frame(width: 38, alignment: .leading)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(syncing && isCurrent && event.stage == .pending
                     ? localizer.text("timeline.syncing")
                     : localizer.eventDescription(event.description.nonEmpty ?? localizer.text(event.stage.localizationKey)))
                    .font(.footnote)
                    .fixedSize(horizontal: false, vertical: true)
                if let location = event.location?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
                    EventLocation(location: location)
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private var time: String {
        guard let date = DateParser.date(event.occurredAt) else { return "—" }
        return localizer.clockTime(date)
    }
}

/// The flag leads and the country closes the place, named in the reader's language.
private struct EventLocation: View {
    let location: String
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        let place = TrackingLocation.place(location)
        if let country = place.country {
            let name = TrackingLocation.countryName(country, language: localizer.language)
            let text = place.name.isEmpty ? name : "\(place.name), \(name)"
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(TrackingLocation.flag(country)).font(.caption)
                Text(text).fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(text)
        } else {
            Text(place.name)
        }
    }
}

struct AutomaticCarrierNotice: View {
    let parcel: Parcel
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        // Only automatic carrier changes need a clock; most cards have none.
        if parcel.carrierData?.autoChangedFrom != nil {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                if let from = parcel.automaticallyChangedFrom(at: context.date) {
                    Text(localizer.text("parcel.autoChangedCarrier", [
                        "carrier": CarrierCatalog.shared.info(for: from, language: localizer.language).displayName,
                    ]))
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
