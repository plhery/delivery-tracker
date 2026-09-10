import SwiftUI
import UIKit

struct ParcelDetailView: View {
    let parcelID: UUID
    let transition: Namespace.ID

    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var showingFullJourney = true
    @State private var showingTitleEditor = false
    @State private var editedTitle = ""
    @State private var copied = false
    @State private var working = false
    @State private var errorMessage: String?
    @State private var showingCarrierEditor = false
    @State private var showingDeleteConfirmation = false

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
                            copy(parcel.trackingNumber)
                        }
                        Button(localizer.text("detail.changeCarrier"), systemImage: "truck.box") {
                            showingCarrierEditor = true
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
        .sheet(isPresented: $showingCarrierEditor) {
            if let parcel {
                ChangeCarrierView(parcel: parcel)
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

    private func identity(_ parcel: Parcel) -> CarrierVisualIdentity {
        CarrierVisualIdentity(id: parcel.displayedCarrier.rawValue,
            carrier: catalog.info(for: parcel.displayedCarrier, language: localizer.language))
    }

    private func liveParcelPass(_ parcel: Parcel) -> some View {
        let branding = identity(parcel)
        let carrier = catalog.info(for: parcel.activeTrackingCarrier, language: localizer.language)
        let trackingLinks = catalog.trackingLinks(for: parcel, language: localizer.language)

        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Button { showingCarrierEditor = true } label: {
                        CarrierFleetMark(identity: branding)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(localizer.text("detail.changeCarrierFrom", ["carrier": carrier.displayName]))
                    Spacer(minLength: 8)
                    Button {
                        run { try await store.setMuted(parcel, muted: !parcel.notificationsMuted) }
                    } label: {
                        Image(systemName: parcel.notificationsMuted ? "bell.slash" : "bell")
                            .font(.system(size: 16, weight: .light))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(branding.ink.opacity(0.75))
                    .disabled(working)
                    .accessibilityLabel(localizer.text(parcel.notificationsMuted ? "detail.unmute" : "detail.mute"))
                }
                HStack(alignment: .center, spacing: 18) {
                    Text(parcel.label.nonEmpty ?? localizer.text("common.parcel"))
                        .font(.title2.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    DeliveryPostageStamp(stage: parcel.currentStage, appeared: true)
                        .scaleEffect(0.8)
                        .frame(width: 44, height: 54)
                }
                if let sender = parcel.carrierData?.senderName?.nonEmpty {
                    Text(localizer.text("parcel.sender", ["sender": sender]))
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
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
            .background(branding.surface, in: RoundedRectangle(cornerRadius: 18))

            shipmentIdentity(parcel, links: trackingLinks, tint: branding.ink)
            if !catalog.tracksAutomatically(parcel.activeTrackingCarrier) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(localizer.text(catalog.trackingHintKey(for: parcel.activeTrackingCarrier), ["carrier": carrier.displayName]))
                        .font(.footnote).foregroundStyle(.secondary)
                    Button(localizer.text("detail.changeCarrier")) { showingCarrierEditor = true }
                        .font(.footnote).foregroundStyle(branding.ink)
                }
            } else if parcel.syncError != nil {
                Text(localizer.text("detail.trackingUnavailable"))
                    .font(.footnote).foregroundStyle(Brand.warning)
            }
            Divider()
        }
        .accessibilityElement(children: .contain)
    }

    private func shipmentIdentity(_ parcel: Parcel, links: [ParcelTrackingLink], tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { trackingLabel; trackingNumber(parcel) }
                    VStack(alignment: .leading, spacing: 4) { trackingLabel; trackingNumber(parcel) }
                }
                Spacer(minLength: 0)
                Button { copy(parcel.trackingNumber) } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 14, weight: .regular))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel(localizer.text(copied ? "detail.copied" : "detail.copyTracking"))
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

    private var trackingLabel: some View {
        Text(localizer.text("detail.trackingNumber"))
            .font(.caption2).foregroundStyle(.secondary)
    }

    private func trackingNumber(_ parcel: Parcel) -> some View {
        Text(CarrierCatalog.format(parcel.trackingNumber))
            .font(.system(.caption, design: .monospaced))
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
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

    private func copy(_ value: String) {
        DeliveryAnalytics.shared.action("parcel-copy-tracking")
        UIPasteboard.general.string = value
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            copied = false
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

    @ObservedObject private var catalog = CarrierCatalog.shared

    init(parcel: Parcel) {
        self.parcel = parcel
        _selectedCarrier = State(initialValue: parcel.carrier)
        _trackingURL = State(initialValue: parcel.trackingURL ?? "")
        _deliveryPostcode = State(initialValue: parcel.dpdPostcode ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(CarrierCatalog.format(parcel.trackingNumber))
                        .font(.system(.body, design: .monospaced, weight: .semibold))
                    Text(localizer.text("detail.changeCarrierDescription", [
                        "number": CarrierCatalog.format(parcel.trackingNumber),
                    ]))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }

                Section(localizer.text("add.carrier")) {
                    Picker(localizer.text("add.carrier"), selection: $selectedCarrier) {
                        if !catalog.info(for: parcel.carrier, language: localizer.language).selectable {
                            Text(catalog.info(for: parcel.carrier, language: localizer.language).displayName).tag(parcel.carrier)
                        }
                        ForEach(catalog.selectableCarriers) { carrier in
                            Text(catalog.info(for: carrier, language: localizer.language).displayName).tag(carrier)
                        }
                    }
                    .pickerStyle(.navigationLink)
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
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var requirements: [CarrierRequirement] {
        catalog.requirements(for: selectedCarrier, trackingNumber: parcel.trackingNumber)
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
                guard requirement.accepts(deliveryPostcode) else { return false }
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
            TextField(
                localizer.text("add.requirement.dpdPostcode"),
                text: $deliveryPostcode
            )
            .keyboardType(requirement.inputMode == "numeric" ? .numberPad : .asciiCapable)
            .textContentType(.postalCode)
            .onChange(of: deliveryPostcode) { _, value in
                deliveryPostcode = requirement.normalizedValue(value)
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
                if let location = event.location?.nonEmpty {
                    Text(TrackingLocation.label(location))
                        .font(.caption2).foregroundStyle(.secondary)
                        .accessibilityLabel(location)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private var time: String {
        guard let date = DateParser.date(event.occurredAt) else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = localizer.language.locale
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}
