import SwiftUI
import UIKit
import VisionKit

struct AddParcelView: View {
    let onOpenParcel: (UUID) -> Void

    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var label: String
    @State private var trackingInput: String
    @State private var trackingURL = ""
    @State private var deliveryPostcode = ""
    @State private var showingScanner = false
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var duplicateParcelID: UUID?
    @State private var carrierOverride: CarrierID?
    @FocusState private var focusedField: Field?

    @ObservedObject private var catalog = CarrierCatalog.shared

    private enum Field: Hashable {
        case label
        case tracking
        case trackingURL
        case deliveryPostcode
    }

    init(draft: SharedParcelDraft?, onOpenParcel: @escaping (UUID) -> Void = { _ in }) {
        self.onOpenParcel = onOpenParcel
        _label = State(initialValue: draft?.label ?? "")
        _trackingInput = State(initialValue: draft?.trackingInput ?? "")
    }

    var body: some View {
        NavigationStack {
            ZStack {
                ExperimentalBackdrop()

                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        labelCard
                        trackingCard

                        if !parsed.trackingNumber.isEmpty {
                            detectionCard
                                .transition(reduceMotion ? .opacity : .offset(y: 6).combined(with: .opacity))
                        }

                        if needsRequiredDetails {
                            requiredDetailsCard
                                .transition(reduceMotion ? .opacity : .offset(y: 6).combined(with: .opacity))
                        }

                        if let errorMessage {
                            errorBanner(errorMessage)
                                .transition(.opacity)
                        }
                    }
                    .disabled(saving)
                    .padding(.horizontal, 18)
                    .padding(.top, 14)
                    .padding(.bottom, 24)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationTitle(localizer.text("add.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.body.weight(.medium))
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(localizer.text("common.cancel"))
                    .disabled(saving)
                    .tint(Brand.ink)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                primaryAction
            }
            .interactiveDismissDisabled(saving)
            .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: parsed.trackingNumber.isEmpty)
            .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: requirements)
            .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: errorMessage)
            .sensoryFeedback(.selection, trigger: resolvedCarrier) { oldValue, newValue in
                oldValue != newValue && newValue != .unknown
            }
            .fullScreenCover(isPresented: $showingScanner) {
                TrackingScannerView { value in
                    withAnimation(reduceMotion ? nil : .snappy(duration: 0.34)) {
                        trackingInput = value
                        showingScanner = false
                    }
                    focusedField = nil
                }
                .environmentObject(localizer)
            }
            .onChange(of: resolvedCarrier, initial: true) { _, carrier in
                prepareRequiredDetails(for: carrier)
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var labelCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(localizer.text("add.contents"))
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(localizer.text("add.optional"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: "tag")
                    .font(.subheadline)
                    .foregroundStyle(ExperimentalPalette.ochre)
                TextField(
                    localizer.text("add.contentsPlaceholder"),
                    text: $label,
                    axis: .vertical
                )
                .font(.body)
                .lineLimit(1...2)
                .accessibilityLabel(localizer.text("add.contents"))
                .accessibilityIdentifier("addParcel.name")
                .submitLabel(.done)
                .focused($focusedField, equals: .label)
                .onSubmit { focusedField = nil }
                .onChange(of: label) { _, value in
                    if value.count > 80 { label = String(value.prefix(80)) }
                }
            }
        }
        .padding(18)
        .experimentalSurface(cornerRadius: 20, shadow: false)
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(ExperimentalPalette.ochre.opacity(focusedField == .label ? 0.5 : 0), lineWidth: 1)
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: focusedField == .label)
    }

    private var trackingCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 18) {
                Text(localizer.text("add.tracking"))
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .tracking(-0.4)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !dynamicTypeSize.isAccessibilitySize {
                    trackingStamp
                }
            }

            HStack(alignment: .top, spacing: 4) {
                TextField(
                    text: $trackingInput,
                    prompt: Text(localizer.text("add.trackingPlaceholder"))
                        .foregroundStyle(Brand.onAccent.opacity(0.55)),
                    axis: .vertical
                ) {
                    Text(localizer.text("add.tracking"))
                }
                .font(.system(.body, design: .monospaced, weight: .medium))
                .lineLimit(2...4)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .tint(Brand.onAccent)
                .accessibilityIdentifier("addParcel.tracking")
                .submitLabel(.done)
                .focused($focusedField, equals: .tracking)
                .onSubmit(submitTracking)
                .onChange(of: trackingInput) { _, _ in
                    duplicateParcelID = nil
                    errorMessage = nil
                    carrierOverride = nil
                }

                if !cleanedInput.isEmpty {
                    Button {
                        withAnimation(reduceMotion ? nil : .snappy) {
                            trackingInput = ""
                            errorMessage = nil
                            duplicateParcelID = nil
                        }
                        focusedField = .tracking
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.body)
                            .foregroundStyle(Brand.onAccent.opacity(0.45))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(TactileButtonStyle())
                    .accessibilityLabel(localizer.text("view.clearAll"))
                }
            }
            .padding(.leading, 14)
            .padding(.trailing, cleanedInput.isEmpty ? 14 : 2)
            .padding(.vertical, 14)
            .background(Color(hex: "#FFF9E8"), in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Brand.onAccent.opacity(focusedField == .tracking ? 0.5 : 0.12), lineWidth: 1)
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: focusedField == .tracking)

            let actionLayout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(spacing: 10))
                : AnyLayout(HStackLayout(spacing: 10))
            actionLayout {
                captureButton(localizer.text("add.paste"), symbol: "doc.on.clipboard", action: paste)
                    .accessibilityIdentifier("addParcel.paste")
                if scannerAvailable {
                    captureButton(localizer.text("add.scan"), symbol: "barcode.viewfinder") {
                        focusedField = nil
                        showingScanner = true
                    }
                }
            }

            if parsed.trackingNumber.isEmpty && !cleanedInput.isEmpty {
                Label(localizer.text("add.notFound"), systemImage: "text.magnifyingglass")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Brand.onAccent.opacity(0.75))
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .foregroundStyle(Brand.onAccent)
        .padding(20)
        .experimentalSurface(fill: Brand.accent, cornerRadius: 24, shadow: false)
    }

    private var trackingStamp: some View {
        Image(systemName: "shippingbox")
            .font(.system(size: 24, weight: .regular))
            .foregroundStyle(Brand.onAccent)
            .frame(width: 54, height: 64)
            .background {
                PostageStampShape().fill(Color(hex: "#FFF9E8"))
                    .shadow(color: .black.opacity(0.08), radius: 2, y: 2)
                Rectangle().stroke(Brand.onAccent.opacity(0.25), lineWidth: 0.7).padding(8)
            }
            .rotationEffect(.degrees(-4))
            .symbolEffect(.bounce, options: .nonRepeating, value: reduceMotion ? nil : resolvedCarrier)
            .accessibilityHidden(true)
    }

    private func captureButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 46)
                .padding(.horizontal, 8)
                .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? 6 : 0)
                .background(.white.opacity(0.42), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(TactileButtonStyle(scale: 0.97))
    }

    private var detectionCard: some View {
        let definition = catalog.info(for: resolvedCarrier, language: localizer.language)
        let automatic = catalog.tracksAutomatically(resolvedCarrier)

        return VStack(alignment: .leading, spacing: 10) {
            Menu {
                Picker(localizer.text("add.carrier"), selection: Binding(
                    get: { carrierOverride },
                    set: { carrier in
                        carrierOverride = carrier
                        focusedField = nil
                        errorMessage = nil
                        duplicateParcelID = nil
                    }
                )) {
                    Text(localizer.text("add.detect")).tag(Optional<CarrierID>.none)
                    ForEach(catalog.selectableCarriers) { carrier in
                        Text(catalog.info(for: carrier, language: localizer.language).displayName)
                            .tag(Optional(carrier))
                    }
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: automatic ? "checkmark.circle.fill" : "questionmark.circle")
                        .font(.title2)
                        .foregroundStyle(detectedTint)
                        .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(localizer.text(carrierOverride == nil && resolvedCarrier != .unknown ? "add.detectedCarrier" : "add.carrier"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(definition.displayName)
                            .font(.headline)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(detectedTint)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(TactileButtonStyle())
            .accessibilityLabel(localizer.text("add.changeCarrier"))
            .accessibilityValue(definition.displayName)
            .accessibilityIdentifier("addParcel.carrier")

            if parsed.source == .link || parsed.source == .text {
                Label(CarrierCatalog.format(parsed.trackingNumber), systemImage: "barcode")
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .accessibilityLabel(localizer.text(parsed.source == .link ? "add.foundLink" : "add.foundText", [
                        "number": CarrierCatalog.format(parsed.trackingNumber),
                    ]))
            }

            if !automatic {
                Text(localizer.text(catalog.trackingHintKey(for: resolvedCarrier), ["carrier": definition.displayName]))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(Brand.ink)
        .padding(16)
        .experimentalSurface(fill: automatic ? ExperimentalPalette.transitSurface : ExperimentalPalette.pickupSurface,
                             cornerRadius: 20, shadow: false)
    }

    private var requiredDetailsCard: some View {
        let strings = ExperimentalCopy(localizer: localizer)

        return VStack(alignment: .leading, spacing: 14) {
            Label(strings.oneMoreDetail, systemImage: postcodeRequirement != nil ? "mappin.and.ellipse" : "link")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ExperimentalPalette.pickup)

            if let requirement = trackingURLRequirement,
               parsed.trackingURL == nil {
                requirementField(
                    title: localizer.text("add.requirement.trackingUrl"),
                    help: localizer.text("add.requirement.trackingUrlHelp")
                ) {
                    TextField(requirement.placeholder ?? "https://…", text: $trackingURL)
                        .font(.body)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focusedField, equals: .trackingURL)
                        .accessibilityLabel(localizer.text("add.requirement.trackingUrl"))
                        .submitLabel(.next)
                        .onSubmit(submitTracking)
                        .onChange(of: trackingURL) { _, value in
                            trackingURL = requirement.normalizedValue(value)
                        }
                }
            }

            if let requirement = postcodeRequirement {
                requirementField(
                    title: localizer.text("add.requirement.dpdPostcode"),
                    help: localizer.text("add.requirement.dpdPostcodeHelp")
                ) {
                    TextField(requirement.placeholder ?? "", text: $deliveryPostcode)
                        .font(.body.monospacedDigit())
                        .keyboardType(requirement.inputMode == "numeric" ? .numberPad : .asciiCapable)
                        .textContentType(.postalCode)
                        .focused($focusedField, equals: .deliveryPostcode)
                        .accessibilityLabel(localizer.text("add.requirement.dpdPostcode"))
                        .onChange(of: deliveryPostcode) { _, value in
                            deliveryPostcode = requirement.normalizedValue(value)
                        }
                }
            }
        }
        .padding(18)
        .experimentalSurface(fill: ExperimentalPalette.pickupSurface, cornerRadius: 20, shadow: false)
    }

    private func requirementField<FieldContent: View>(
        title: String,
        help: String,
        @ViewBuilder field: () -> FieldContent
    ) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            field()
                .padding(14)
                .background(Brand.paper, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Brand.separator.opacity(0.3), lineWidth: 0.7))
            Text(help)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func errorBanner(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                Text(message)
                    .font(.subheadline.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            if let duplicateParcelID {
                Button(localizer.text("add.openExisting")) {
                    dismiss()
                    onOpenParcel(duplicateParcelID)
                }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.plain)
                .foregroundStyle(Brand.ink)
                .underline()
            }
        }
        .padding(16)
        .experimentalSurface(fill: ExperimentalPalette.roseSurface, cornerRadius: 20, shadow: false)
    }

    private var primaryAction: some View {
        addButton
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
            .background(Brand.background)
    }

    private var addButton: some View {
        Button(action: save) {
            HStack(spacing: 10) {
                if saving {
                    ProgressView().tint(Brand.onAccent)
                    Text(localizer.text("add.adding"))
                } else {
                    Image(systemName: "plus")
                        .fontWeight(.bold)
                    Text(localizer.text("app.addParcel"))
                }
            }
            .font(.headline)
            .foregroundStyle(canSave || saving ? Brand.onAccent : Brand.ink.opacity(0.45))
            .frame(maxWidth: .infinity, minHeight: 56)
            .padding(.horizontal, 16)
            .background(canSave || saving ? Brand.accent : Brand.cream, in: RoundedRectangle(cornerRadius: 18))
            .contentTransition(.opacity)
        }
        .buttonStyle(TactileButtonStyle())
        .accessibilityIdentifier("addParcel.save")
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: canSave)
        .disabled(!canSave || saving)
    }

    private var cleanedInput: String {
        trackingInput.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var scannerAvailable: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    private var parsed: TrackingInputMatch { catalog.parse(trackingInput) }

    private var resolvedCarrier: CarrierID {
        carrierOverride ?? parsed.carrier
    }

    private var detectedTint: Color {
        catalog.tracksAutomatically(resolvedCarrier)
            ? ExperimentalPalette.transit
            : ExperimentalPalette.pickup
    }

    private var requirements: [CarrierRequirement] {
        catalog.requirements(for: resolvedCarrier, trackingNumber: parsed.trackingNumber)
    }

    private var trackingURLRequirement: CarrierRequirement? {
        requirements.first(where: { $0.field == .trackingURL })
    }

    private var postcodeRequirement: CarrierRequirement? {
        requirements.first(where: { $0.field == .dpdPostcode })
    }

    private var needsRequiredDetails: Bool {
        (trackingURLRequirement != nil && parsed.trackingURL == nil)
            || postcodeRequirement != nil
    }

    private var canSave: Bool {
        guard !parsed.trackingNumber.isEmpty else { return false }
        for requirement in requirements {
            switch requirement.field {
            case .trackingURL:
                let value = requirement.normalizedValue(parsed.trackingURL ?? trackingURL)
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

    private func prepareRequiredDetails(for carrier: CarrierID) {
        guard postcodeRequirement != nil, deliveryPostcode.isEmpty else { return }
        let previous = store.parcels
            .sorted(by: { $0.createdAt > $1.createdAt })
            .first(where: { $0.carrier == carrier && $0.dpdPostcode != nil })?
            .dpdPostcode ?? ""
        deliveryPostcode = postcodeRequirement?.normalizedValue(previous) ?? ""
    }

    private func paste() {
        guard let value = UIPasteboard.general.string?.trimmingCharacters(
            in: .whitespacesAndNewlines
        ), !value.isEmpty else {
            errorMessage = localizer.text("add.pasteFailed")
            return
        }
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.34)) {
            errorMessage = nil
            trackingInput = value
        }
        focusedField = nil
    }

    private func submitTracking() {
        if let requirement = trackingURLRequirement,
           parsed.trackingURL == nil,
           !requirement.accepts(trackingURL) {
            focusedField = .trackingURL
        } else if let requirement = postcodeRequirement,
                  !requirement.accepts(deliveryPostcode) {
            focusedField = .deliveryPostcode
        } else if canSave {
            save()
        }
    }

    private func save() {
        guard canSave, !saving else { return }
        focusedField = nil
        saving = true
        errorMessage = nil
        duplicateParcelID = nil

        Task {
            do {
                try await store.add(
                    trackingNumber: parsed.trackingNumber,
                    label: label,
                    carrier: resolvedCarrier,
                    trackingURL: trackingURLRequirement != nil
                        ? (parsed.trackingURL ?? trackingURL) : nil,
                    dpdPostcode: postcodeRequirement != nil ? deliveryPostcode : nil
                )
                dismiss()
            } catch {
                if let apiError = error as? DeliveryAPIError,
                   case .duplicateTracking(let packageID) = apiError {
                    duplicateParcelID = packageID
                }
                errorMessage = localizer.errorMessage(error)
                saving = false
            }
        }
    }
}

struct TrackingScannerView: View {
    let onScan: (String) -> Void
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TrackingDataScanner(onScan: onScan)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(localizer.text("add.scanTitle"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(localizer.text("common.cancel")) { dismiss() }
                    }
                }
        }
    }
}

private struct TrackingDataScanner: UIViewControllerRepresentable {
    let onScan: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode()],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: true,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        Task { @MainActor in try? scanner.startScanning() }
        return scanner
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}

    static func dismantleUIViewController(
        _ uiViewController: DataScannerViewController,
        coordinator: Coordinator
    ) {
        uiViewController.stopScanning()
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onScan: (String) -> Void
        private var delivered = false

        init(onScan: @escaping (String) -> Void) { self.onScan = onScan }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            guard !delivered else { return }
            for item in addedItems {
                guard case .barcode(let barcode) = item,
                      let value = barcode.payloadStringValue?.trimmingCharacters(
                        in: .whitespacesAndNewlines
                      ), !value.isEmpty else { continue }
                delivered = true
                onScan(value)
                return
            }
        }
    }
}

struct ParcelFilterView: View {
    @Binding var status: ParcelStatusFilter
    @Binding var carrier: CarrierID?
    @Binding var sort: ParcelSort
    let carriers: [CarrierID]
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var catalog = CarrierCatalog.shared

    var body: some View {
        NavigationStack {
            Form {
                Section(localizer.text("view.status")) {
                    Picker(localizer.text("view.status"), selection: $status) {
                        ForEach(ParcelStatusFilter.allCases) { value in
                            Text(localizer.text(value.localizationKey)).tag(value)
                        }
                    }
                    .pickerStyle(.inline)
                }
                Section(localizer.text("view.carrier")) {
                    Picker(localizer.text("view.carrier"), selection: $carrier) {
                        Text(localizer.text("view.allCarriers")).tag(Optional<CarrierID>.none)
                        ForEach(carriers) { value in
                            Text(catalog.info(for: value, language: localizer.language).displayName).tag(Optional(value))
                        }
                    }
                }
                Section(localizer.text("view.sort")) {
                    Picker(localizer.text("view.sort"), selection: $sort) {
                        ForEach(ParcelSort.allCases) { value in
                            Text(localizer.text(value.localizationKey)).tag(value)
                        }
                    }
                    .pickerStyle(.inline)
                }
                Section {
                    Button(localizer.text("view.clear"), role: .destructive) {
                        status = .all
                        carrier = nil
                        sort = .priority
                    }
                }
            }
            .navigationTitle(localizer.text("view.showControls"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(localizer.text("native.done")) { dismiss() }.fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
