import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let statusLabel = UILabel()
    private var finished = false
    private var saved = false
    private let cancelButton = UIButton(type: .system)
    private let openButton = UIButton(type: .system)
    private var parcelLabel = ""
    private var trackingInput = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.969, green: 0.953, blue: 0.918, alpha: 1)
        configureInterface()
        loadSharedContent()
    }

    private func configureInterface() {
        let mark = UIImageView(image: UIImage(systemName: "shippingbox.fill"))
        mark.preferredSymbolConfiguration = .init(pointSize: 34, weight: .semibold)
        mark.tintColor = UIColor(red: 0.09, green: 0.09, blue: 0.08, alpha: 1)
        mark.backgroundColor = UIColor(red: 1, green: 0.84, blue: 0.04, alpha: 1)
        mark.layer.cornerRadius = 22
        mark.contentMode = .center
        mark.translatesAutoresizingMaskIntoConstraints = false

        let title = UILabel()
        title.text = ShareCopy.text("title")
        title.font = .preferredFont(forTextStyle: .title2).withWeight(.bold)
        title.textAlignment = .center

        statusLabel.text = ShareCopy.text("reading")
        statusLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusLabel.textColor = .secondaryLabel
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center

        var openConfiguration = UIButton.Configuration.filled()
        openConfiguration.title = ShareCopy.text("save")
        openConfiguration.image = UIImage(systemName: "tray.and.arrow.down")
        openConfiguration.imagePadding = 8
        openConfiguration.cornerStyle = .large
        openConfiguration.baseBackgroundColor = UIColor(red: 1, green: 0.81, blue: 0, alpha: 1)
        openConfiguration.baseForegroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.08, alpha: 1)
        openButton.configuration = openConfiguration
        openButton.isEnabled = false
        openButton.addTarget(self, action: #selector(saveShare), for: .touchUpInside)

        cancelButton.setTitle(ShareCopy.text("cancel"), for: .normal)
        cancelButton.addTarget(self, action: #selector(cancelShare), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [mark, title, statusLabel, openButton, cancelButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 18
        stack.setCustomSpacing(26, after: statusLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            mark.widthAnchor.constraint(equalToConstant: 76),
            mark.heightAnchor.constraint(equalToConstant: 76),
            openButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
            openButton.heightAnchor.constraint(equalToConstant: 52),
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor, constant: -8),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    private func loadSharedContent() {
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        parcelLabel = items.compactMap { $0.attributedTitle?.string.trimmed.nonEmpty }
            .first.map { String($0.prefix(80)) } ?? ""
        let itemText = items.compactMap { $0.attributedContentText?.string.trimmed.nonEmpty }
        let candidates = providers.compactMap { provider -> (NSItemProvider, String)? in
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                return (provider, UTType.url.identifier)
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                return (provider, UTType.plainText.identifier)
            }
            return nil
        }
        guard !candidates.isEmpty || !itemText.isEmpty else {
            statusLabel.text = ShareCopy.text("notFound")
            return
        }

        var loaded = Array<String?>(repeating: nil, count: candidates.count)
        var lastError: Error?
        let group = DispatchGroup()
        for (index, candidate) in candidates.enumerated() {
            group.enter()
            candidate.0.loadItem(forTypeIdentifier: candidate.1) { value, error in
                let text: String?
                if let url = value as? URL { text = url.absoluteString }
                else if let textValue = value as? String { text = textValue }
                else if let data = value as? Data { text = String(data: data, encoding: .utf8) }
                else { text = nil }
                DispatchQueue.main.async {
                    loaded[index] = text?.trimmed.nonEmpty
                    if let error { lastError = error }
                    group.leave()
                }
            }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self, !self.finished else { return }
            let parts = (loaded.compactMap { $0 } + itemText).reduce(into: [String]()) { result, value in
                if !result.contains(value) { result.append(value) }
            }
            self.trackingInput = String(parts.joined(separator: "\n").prefix(10_000))
            if self.trackingInput.isEmpty {
                self.statusLabel.text = lastError?.localizedDescription ?? ShareCopy.text("notFound")
            } else {
                self.statusLabel.text = ShareCopy.text("ready")
                self.openButton.isEnabled = true
            }
        }
    }

    @objc private func saveShare() {
        guard !finished, !saved, !trackingInput.isEmpty else { return }
        guard ShareInbox.save(SharedParcelDraft(label: parcelLabel, trackingInput: trackingInput)) else {
            statusLabel.text = ShareCopy.text("saveFailed")
            return
        }
        saved = true
        statusLabel.text = ShareCopy.text("saved")
        openButton.isHidden = true
        cancelButton.setTitle(ShareCopy.text("done"), for: .normal)
    }

    @objc private func cancelShare() {
        finished = true
        if saved {
            extensionContext?.completeRequest(returningItems: nil)
        } else {
            extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
        }
    }

}

private enum ShareCopy {
    private static let catalogs: [String: [String: String]] = [
        "en": [
            "title": "Add to Delivery Tracker",
            "reading": "Reading the shared tracking information…",
            "save": "Save tracking details",
            "saved": "Saved. Open Delivery Tracker within 10 minutes to review and add your parcel.",
            "done": "Done",
            "saveFailed": "Could not save. Please paste the tracking information directly in the app.",
            "cancel": "Cancel",
            "notFound": "Share a tracking number or link, or paste it directly in the app.",
            "ready": "Save these tracking details, then open Delivery Tracker to add your parcel.",
        ],
        "de": [
            "title": "Zu Delivery Tracker hinzufügen",
            "reading": "Geteilte Sendungsinformationen werden gelesen…",
            "save": "Sendungsangaben speichern",
            "saved": "Gespeichert. Öffne Delivery Tracker innerhalb von 10 Minuten, um dein Paket zu prüfen und hinzuzufügen.",
            "done": "Fertig",
            "saveFailed": "Speichern fehlgeschlagen. Bitte füge die Sendungsangaben direkt in der App ein.",
            "cancel": "Abbrechen",
            "notFound": "Teile eine Sendungsnummer oder einen Link oder füge sie direkt in der App ein.",
            "ready": "Speichere die Sendungsangaben und öffne dann Delivery Tracker, um dein Paket hinzuzufügen.",
        ],
        "fr": [
            "title": "Ajouter à Delivery Tracker",
            "reading": "Lecture des informations de suivi partagées…",
            "save": "Enregistrer le suivi",
            "saved": "Enregistré. Ouvrez Delivery Tracker dans les 10 minutes pour vérifier et ajouter votre colis.",
            "done": "Terminé",
            "saveFailed": "Échec de l’enregistrement. Collez les informations de suivi directement dans l’app.",
            "cancel": "Annuler",
            "notFound": "Partagez un numéro ou un lien de suivi, ou collez-le directement dans l’app.",
            "ready": "Enregistrez le suivi, puis ouvrez Delivery Tracker pour ajouter votre colis.",
        ],
        "it": [
            "title": "Aggiungi a Delivery Tracker",
            "reading": "Lettura delle informazioni di tracciamento condivise…",
            "save": "Salva il tracciamento",
            "saved": "Salvato. Apri Delivery Tracker entro 10 minuti per verificare e aggiungere il pacco.",
            "done": "Fine",
            "saveFailed": "Salvataggio non riuscito. Incolla il tracciamento direttamente nell’app.",
            "cancel": "Annulla",
            "notFound": "Condividi un numero o un link di tracciamento, oppure incollalo direttamente nell’app.",
            "ready": "Salva il tracciamento, poi apri Delivery Tracker per aggiungere il pacco.",
        ],
    ]

    static func text(_ key: String) -> String {
        let group = Bundle.main.object(forInfoDictionaryKey: "SDTAppGroupIdentifier") as? String
            ?? "group.com.plhery.SwissDeliveryTracker"
        let saved = UserDefaults(suiteName: group)?.string(forKey: "deliveryTrackerLocale")
        let preferred = Locale.preferredLanguages.map { $0.split(separator: "-").first.map(String.init) ?? "" }
        let language = ([saved].compactMap { $0 } + preferred).first { catalogs[$0] != nil } ?? "en"
        return catalogs[language]?[key] ?? catalogs["en"]?[key] ?? key
    }
}

private extension UIFont {
    func withWeight(_ weight: UIFont.Weight) -> UIFont {
        let descriptor = fontDescriptor.addingAttributes([
            .traits: [UIFontDescriptor.TraitKey.weight: weight],
        ])
        return UIFont(descriptor: descriptor, size: pointSize)
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var nonEmpty: String? { isEmpty ? nil : self }
}
