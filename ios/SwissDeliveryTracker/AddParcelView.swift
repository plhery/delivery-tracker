import SwiftUI
import UIKit
import VisionKit

struct AddParcelView: View {
    let onOpenParcel: (UUID) -> Void
    let onAdded: (UUID) -> Void

    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var label: String
    @State private var trackingInput: String
    @State private var trackingURL = ""
    @State private var deliveryPostcode = ""
    @State private var showingScanner = false
    @State private var didFocusTracking = false
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var duplicateParcelID: UUID?
    @State private var carrierOverride: CarrierID?
    @State private var verifiedCarrier: CarrierDetectionResponse?
    @FocusState private var focusedField: Field?

    @ObservedObject private var catalog = CarrierCatalog.shared

    private enum Field: Hashable {
        case label
        case tracking
        case trackingURL
        case deliveryPostcode
    }

    init(draft: SharedParcelDraft?, onOpenParcel: @escaping (UUID) -> Void = { _ in }, onAdded: @escaping (UUID) -> Void = { _ in }) {
        self.onOpenParcel = onOpenParcel
        self.onAdded = onAdded
        _label = State(initialValue: draft?.label ?? "")
        _trackingInput = State(initialValue: draft?.trackingInput ?? "")
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                heading

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        VStack(alignment: .leading, spacing: 6) {
                            trackingField
                            if !parsed.trackingNumber.isEmpty {
                                carrierFeedback
                                    .transition(reduceMotion ? .opacity : .offset(y: 6).combined(with: .opacity))
                            }
                        }

                        if needsRequiredDetails {
                            requiredDetails
                                .transition(reduceMotion ? .opacity : .offset(y: 6).combined(with: .opacity))
                        }

                        nameField

                        if let errorMessage {
                            errorBanner(errorMessage)
                                .transition(.opacity)
                        }
                    }
                    .disabled(saving)
                    .padding(.horizontal, 20)
                    .padding(.top, 4)
                    .padding(.bottom, 24)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
            }
            .background(Brand.background)
            .toolbar(.hidden, for: .navigationBar)
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
            .task {
                guard !didFocusTracking else { return }
                didFocusTracking = true
                // Wait for the full-screen presentation before opening the keyboard.
                do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
                focusedField = .tracking
            }
            .onChange(of: resolvedCarrier, initial: true) { _, carrier in
                prepareRequiredDetails(for: carrier)
            }
            .task(id: lookupTrackingNumber) {
                guard let number = lookupTrackingNumber else { return }
                do {
                    try await Task.sleep(for: .milliseconds(350))
                    let result = try await store.detectCarrier(trackingNumber: number)
                    guard !Task.isCancelled else { return }
                    guard result.trackingNumber == number else { throw DeliveryAPIError.invalidResponse }
                    verifiedCarrier = result
                } catch {
                    guard !Task.isCancelled else { return }
                    verifiedCarrier = CarrierDetectionResponse(trackingNumber: number, carrier: .unknown)
                }
            }
        }
    }

    private var heading: some View {
        HStack(spacing: 12) {
            Text(localizer.text("add.title"))
                .font(.title2.weight(.semibold))
                .tracking(-0.5)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.medium))
                    .frame(width: 36, height: 36)
                    .background(Brand.cream, in: Circle())
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(localizer.text("common.close"))
            .accessibilityIdentifier("addParcel.close")
            .disabled(saving)
        }
        .foregroundStyle(Brand.ink)
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 18)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(localizer.text("design.parcelTitle"))
                    .font(.subheadline.weight(.medium))
                Text(localizer.text("add.optional"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            TextField(localizer.text("add.contentsPlaceholder"), text: $label)
                .font(.body)
                .accessibilityLabel(localizer.text("design.parcelTitle"))
                .accessibilityIdentifier("addParcel.name")
                .submitLabel(.done)
                .focused($focusedField, equals: .label)
                .onSubmit {
                    if canSave { save() } else { focusedField = .tracking }
                }
                .onChange(of: label) { _, value in
                    if value.count > 80 { label = String(value.prefix(80)) }
                }
                .padding(14)
                .background(Brand.paper, in: RoundedRectangle(cornerRadius: 14))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(focusedField == .label ? ExperimentalPalette.ochre : Brand.separator.opacity(0.3), lineWidth: 1)
                }
        }
        .foregroundStyle(Brand.ink)
    }

    private var trackingField: some View {
        VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    trackingLabel
                    Spacer(minLength: 4)
                    captureActions
                }
                VStack(alignment: .leading, spacing: 0) {
                    trackingLabel
                    captureActions
                }
            }
            TextField(
                localizer.text("add.trackingPlaceholder"),
                text: $trackingInput,
                axis: .vertical
            )
            .font(.body)
            .lineLimit(2...4)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .accessibilityLabel(localizer.text("add.tracking"))
            .accessibilityIdentifier("addParcel.tracking")
            .submitLabel(.next)
            .focused($focusedField, equals: .tracking)
            .onSubmit(submitTracking)
            .onChange(of: trackingInput) { _, _ in
                duplicateParcelID = nil
                errorMessage = nil
                carrierOverride = nil
            }
            .padding(14)
            .background(Brand.paper, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(focusedField == .tracking ? ExperimentalPalette.ochre : Brand.separator.opacity(0.3), lineWidth: 1)
            }

            if parsed.trackingNumber.isEmpty && !cleanedInput.isEmpty {
                Text(localizer.text("add.notFound"))
                    .font(.caption)
                    .foregroundStyle(Brand.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(Brand.ink)
    }

    private var trackingLabel: some View {
        Text(localizer.text("add.tracking"))
            .font(.subheadline.weight(.medium))
            .fixedSize(horizontal: false, vertical: true)
    }

    private var captureActions: some View {
        HStack(spacing: 12) {
            Button(action: paste) {
                Label(localizer.text("add.paste"), systemImage: "doc.on.clipboard")
                    .font(.caption)
                    .fixedSize()
                    .frame(minHeight: 44)
            }
            .accessibilityIdentifier("addParcel.paste")
            if scannerAvailable {
                Button {
                    DeliveryAnalytics.shared.action("parcel-scan")
                    focusedField = nil
                    showingScanner = true
                } label: {
                    Image(systemName: "barcode.viewfinder")
                        .font(.body)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel(localizer.text("add.scan"))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
    }

    private var carrierFeedback: some View {
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
                HStack(spacing: 8) {
                    Image(systemName: "truck.box")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(definition.displayName).font(.subheadline.weight(.medium))
                            carrierDetectionLabel
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(definition.displayName).font(.subheadline.weight(.medium))
                            carrierDetectionLabel
                        }
                    }
                    Spacer(minLength: 0)
                    Text(localizer.text("add.changeCarrier"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .underline()
                        .fixedSize(horizontal: false, vertical: true)
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
    }

    private var carrierDetectionLabel: some View {
        Text(localizer.text(carrierOverride == nil && resolvedCarrier != .unknown ? "add.detectedCarrier" : "add.carrier"))
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    private var requiredDetails: some View {
        VStack(alignment: .leading, spacing: 20) {
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
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
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
                    Text(localizer.text("app.addParcel"))
                }
            }
            .font(.headline)
            .foregroundStyle(Brand.onAccent)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(Brand.accent, in: RoundedRectangle(cornerRadius: 14))
            .opacity(canSave || saving ? 1 : 0.45)
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
        if let carrierOverride { return carrierOverride }
        if let number = lookupTrackingNumber, verifiedCarrier?.trackingNumber == number {
            return verifiedCarrier?.carrier ?? parsed.carrier
        }
        return parsed.carrier
    }

    private var lookupTrackingNumber: String? {
        let number = CarrierCatalog.normalize(parsed.trackingNumber)
        guard !store.isDemo, carrierOverride == nil, parsed.carrier == .unknown,
              number.range(of: "^[0-9]{11,12}$", options: .regularExpression) != nil else { return nil }
        return number
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
        if let number = lookupTrackingNumber, verifiedCarrier?.trackingNumber != number { return false }
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
        DeliveryAnalytics.shared.action("parcel-paste")
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
        focusedField = .tracking
    }

    private func submitTracking() {
        if let requirement = trackingURLRequirement,
           parsed.trackingURL == nil,
           !requirement.accepts(trackingURL) {
            focusedField = .trackingURL
        } else if let requirement = postcodeRequirement,
                  !requirement.accepts(deliveryPostcode) {
            focusedField = .deliveryPostcode
        } else {
            focusedField = .label
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
                let parcel = try await store.add(
                    trackingNumber: parsed.trackingNumber,
                    label: label,
                    carrier: resolvedCarrier,
                    trackingURL: trackingURLRequirement != nil
                        ? (parsed.trackingURL ?? trackingURL) : nil,
                    dpdPostcode: postcodeRequirement != nil ? deliveryPostcode : nil
                )
                onAdded(parcel.id)
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

/// Applied outside the card's swipe clipping so the little parcels can leave its edge.
struct ParcelArrivalCelebration: ViewModifier {
    let active: Bool
    var stubInset: CGFloat = 30
    let onFinished: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var progress = 0.0

    func body(content: Content) -> some View {
        content
            .overlay {
                if active {
                    ParcelAddedBurst(stubInset: stubInset, onFinished: onFinished)
                }
            }
            .modifier(ParcelArrivalEffect(progress: progress, reduced: reduceMotion))
            .onChange(of: active, initial: true) { _, active in
                if active {
                    withAnimation(.linear(duration: reduceMotion ? 0.75 : 0.48)) { progress = 1 }
                } else {
                    var transaction = Transaction(animation: nil)
                    transaction.disablesAnimations = true
                    withTransaction(transaction) { progress = 0 }
                }
            }
            .onDisappear { if active { onFinished() } }
    }
}

private struct ParcelArrivalEffect: ViewModifier, Animatable {
    var progress: Double
    let reduced: Bool
    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func body(content: Content) -> some View {
        let wobble = sin(progress * .pi * 6) * (1 - progress)
        let pulse = sin(progress * .pi)
        content
            .offset(x: reduced ? 0 : wobble * 3)
            .rotationEffect(.degrees(reduced ? 0 : wobble * 1.1))
            .scaleEffect(reduced ? 1 : 1 + pulse * 0.012)
            .brightness(reduced ? pulse * 0.08 : 0)
    }
}

/// Small, uneven sparks from the new card's stamp; follows its position while scrolling.
struct ParcelAddedBurst: View {
    let stubInset: CGFloat
    let onFinished: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var started = Date()

    // Horizontal spread, upward impulse, rotation, size, launch delay.
    private static let parcels: [(Double, Double, Double, Double, Double)] = [
        (-1, 90, -80, 19, 0.02), (-0.7, 145, 65, 24, 0),
        (-0.35, 115, -100, 21, 0.05), (0, 155, 85, 25, 0.03),
        (0.35, 120, -55, 20, 0.06), (0.6, 95, 100, 22, 0.01),
    ]

    var body: some View {
        GeometryReader { geometry in
            if !reduceMotion {
                TimelineView(.animation) { timeline in
                    let elapsed = max(0, timeline.date.timeIntervalSince(started))
                    let origin = CGPoint(x: geometry.size.width - stubInset, y: geometry.size.height / 2)
                    let spread = min(geometry.size.width * 0.25, 80)
                    ForEach(Self.parcels.indices, id: \.self) { index in
                        particle(index, elapsed: elapsed, origin: origin, spread: spread)
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .task {
            do { try await Task.sleep(for: .seconds(reduceMotion ? 0.75 : 0.95)) }
            catch { return }
            onFinished()
        }
        .onChange(of: reduceMotion) { _, _ in onFinished() }
    }

    private func particle(_ index: Int, elapsed: TimeInterval, origin: CGPoint, spread: CGFloat) -> some View {
        let parcel = Self.parcels[index]
        let progress = max(0, min(1, (elapsed - parcel.4) / 0.8))
        let rotation = parcel.2 * progress + sin(progress * .pi * 2) * 8
        let scale = min(1, progress / 0.12) * (1 - progress * 0.25)
        let opacity = min(1, progress / 0.05) * min(1, (1 - progress) / 0.3)
        let x = origin.x + CGFloat(parcel.0 * (1 - pow(1 - progress, 2))) * spread
        let y = origin.y + CGFloat(-parcel.1 * progress + 120 * progress * progress)
        return Text("📦").font(.system(size: CGFloat(parcel.3)))
            .rotationEffect(.degrees(rotation)).scaleEffect(scale).opacity(opacity)
            .position(x: x, y: y)
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
