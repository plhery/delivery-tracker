import SwiftUI

enum ExperimentalPalette {
    static let transit = Brand.color(light: "#526E89", dark: "#A1BAD0")
    static let pickup = Brand.warning
    static let delivered = Brand.color(light: "#4D735F", dark: "#A1C4AD")
    static let lilac = Brand.color(light: "#7A658C", dark: "#C3AFD4")
    static let rose = Brand.color(light: "#A36570", dark: "#DEA7B2")
    static let ochre = Brand.color(light: "#7B5E2C", dark: "#DCC18A")

    static func tint(for parcel: Parcel) -> Color {
        switch parcel.currentStage {
        case .delivered:
            delivered
        case .customs, .failedAttempt, .readyForPickup, .returned:
            pickup
        case .inTransit:
            transit
        case .outForDelivery:
            ochre
        case .pending, .registered, .none:
            lilac
        default:
            transit
        }
    }
}

struct ExperimentalBackdrop: View {
    var body: some View {
        Brand.background.ignoresSafeArea()
    }
}

extension View {
    func experimentalSurface(
        tint: Color = .clear,
        cornerRadius: CGFloat = 26,
        shadow: Bool = true
    ) -> some View {
        background {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(Brand.paper)
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(tint.opacity(0.08))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .stroke(Brand.separator.opacity(0.42), lineWidth: 0.6)
                }
                .shadow(
                    color: shadow ? .black.opacity(0.035) : .clear,
                    radius: shadow ? 10 : 0,
                    y: shadow ? 4 : 0
                )
        }
    }

}

struct ExperimentalLiftButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .offset(y: configuration.isPressed && !reduceMotion ? 1.5 : 0)
            .brightness(configuration.isPressed ? -0.025 : 0)
            .animation(reduceMotion ? nil : .snappy(duration: 0.22), value: configuration.isPressed)
    }
}

struct ExperimentalCarrierToken: View {
    let carrier: CarrierDefinition
    let tint: Color

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "shippingbox.fill")
                .font(.caption2.weight(.bold))
            Text(carrier.displayName)
                .lineLimit(1)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.primary)
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(tint.opacity(0.14), in: Capsule())
        .overlay(Capsule().stroke(tint.opacity(0.22), lineWidth: 0.7))
    }
}

struct ExperimentalJourneyRail: View {
    let stage: TrackingStage?
    let tint: Color
    var compact = false

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let current = max(0, min(stage?.metadata.progress ?? 0, TrackingStage.core.count - 1))

        HStack(spacing: compact ? 4 : 5) {
            ForEach(Array(TrackingStage.core.enumerated()), id: \.offset) { index, _ in
                Capsule()
                    .fill(index <= current ? tint : Color.secondary.opacity(0.15))
                    .frame(height: index == current ? (compact ? 4 : 5) : 3)
            }
        }
        .frame(height: compact ? 5 : 6)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.24), value: current)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(localizer.text("native.deliveryProgress"))
        .accessibilityValue(
            localizer.text("progress.step", [
                "step": current + 1,
                "total": TrackingStage.core.count,
                "stage": localizer.text(stage?.localizationKey ?? "status.pending"),
            ])
        )
    }
}

struct ExperimentalCopy {
    let language: AppLanguage

    var passport: String { value(en: "Passport", de: "Reisepass", fr: "Passeport", it: "Passaporto") }
    var active: String { value(en: "Active", de: "Aktiv", fr: "En cours", it: "Attivi") }
    var showArchive: String {
        value(en: "Show archived parcels", de: "Archivierte Pakete anzeigen", fr: "Afficher les colis archivés", it: "Mostra i pacchi archiviati")
    }
    var hideArchive: String {
        value(en: "Hide archived parcels", de: "Archivierte Pakete ausblenden", fr: "Masquer les colis archivés", it: "Nascondi i pacchi archiviati")
    }
    var currentUpdate: String { value(en: "Current update", de: "Aktueller Stand", fr: "Dernière nouvelle", it: "Ultimo aggiornamento") }
    var fullJourney: String { value(en: "Show full journey", de: "Ganze Reise zeigen", fr: "Afficher tout le trajet", it: "Mostra tutto il viaggio") }
    var lessJourney: String { value(en: "Show less", de: "Weniger zeigen", fr: "Afficher moins", it: "Mostra meno") }
    var shipmentDetails: String { value(en: "Shipment details", de: "Sendungsdetails", fr: "Détails de l’envoi", it: "Dettagli della spedizione") }
    var smartCapture: String { value(en: "Tracking details", de: "Sendungsangaben", fr: "Informations de suivi", it: "Dati di tracciamento") }
    var scanOrEnter: String {
        value(en: "Paste the tracking number or link from your shipping message.", de: "Füge die Sendungsnummer oder den Link aus deiner Versandnachricht ein.", fr: "Collez le numéro ou le lien de suivi de votre message d’expédition.", it: "Incolla il numero o il link di tracciamento del messaggio di spedizione.")
    }
    var quickAddIntro: String {
        value(en: "Add a tracking number or link. Give your parcel a name if you like.", de: "Füge eine Sendungsnummer oder einen Link hinzu. Du kannst dem Paket auch einen Namen geben.", fr: "Ajoutez un numéro ou un lien de suivi. Donnez un nom au colis si vous le souhaitez.", it: "Aggiungi un numero o un link di tracciamento. Se vuoi, dai un nome al pacco.")
    }
    var parcelTitle: String { value(en: "Title", de: "Titel", fr: "Titre", it: "Titolo") }
    var trackingReady: String {
        value(en: "Ready to add", de: "Bereit zum Hinzufügen", fr: "Prêt à ajouter", it: "Pronto da aggiungere")
    }
    var oneMoreDetail: String {
        value(en: "One detail needed", de: "Noch eine Angabe", fr: "Un détail nécessaire", it: "Serve ancora un dettaglio")
    }
    var ready: String { value(en: "Ready to review", de: "Bereit zur Prüfung", fr: "Prêt à vérifier", it: "Pronto da verificare") }
    var chooseNext: String {
        value(en: "Carrier details can be confirmed next.", de: "Anbieterdetails können als Nächstes bestätigt werden.", fr: "Vous pourrez ensuite confirmer le transporteur.", it: "Potrai confermare i dettagli del corriere nel passaggio successivo.")
    }
    var continueTitle: String { value(en: "Review parcel", de: "Paket prüfen", fr: "Vérifier le colis", it: "Verifica il pacco") }
    var scanTitle: String { value(en: "Scan instead", de: "Stattdessen scannen", fr: "Scanner plutôt", it: "Scansiona invece") }

    private func value(en: String, de: String, fr: String, it: String) -> String {
        switch language {
        case .en: en
        case .de: de
        case .fr: fr
        case .it: it
        }
    }
}

extension Parcel {
    var experimentalLatestLocation: String? {
        sortedEvents.compactMap { $0.location?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty }.first
    }
}
