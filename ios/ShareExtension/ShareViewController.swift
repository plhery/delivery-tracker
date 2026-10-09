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
    // The app saves its language to the App Group whenever it is set.
    private let copy = ExtensionLocalizer(savedLanguageCode: ShareInbox.defaults?.string(forKey: "deliveryTrackerLocale"))

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.969, green: 0.953, blue: 0.918, alpha: 1)
        configureInterface()
        loadSharedContent()
    }

    private func configureInterface() {
        let markSize: CGFloat = 76
        let mark = UIImageView(image: UIGraphicsImageRenderer(size: CGSize(width: markSize, height: markSize)).image { renderer in
            PeekMarkArtwork.draw(in: renderer.cgContext, size: markSize)
        })
        mark.translatesAutoresizingMaskIntoConstraints = false

        let title = UILabel()
        title.text = copy.text("shareExtension.title")
        title.font = .preferredFont(forTextStyle: .title2).withWeight(.bold)
        title.textAlignment = .center

        statusLabel.text = copy.text("shareExtension.reading")
        statusLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusLabel.textColor = .secondaryLabel
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center

        var openConfiguration = UIButton.Configuration.filled()
        openConfiguration.title = copy.text("shareExtension.save")
        openConfiguration.image = UIImage(systemName: "tray.and.arrow.down")
        openConfiguration.imagePadding = 8
        openConfiguration.cornerStyle = .large
        openConfiguration.baseBackgroundColor = UIColor(red: 1, green: 0.81, blue: 0, alpha: 1)
        openConfiguration.baseForegroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.08, alpha: 1)
        openButton.configuration = openConfiguration
        openButton.isEnabled = false
        openButton.addTarget(self, action: #selector(saveShare), for: .touchUpInside)

        cancelButton.setTitle(copy.text("common.cancel"), for: .normal)
        cancelButton.addTarget(self, action: #selector(cancelShare), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [mark, title, statusLabel, openButton, cancelButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 18
        stack.setCustomSpacing(26, after: statusLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            mark.widthAnchor.constraint(equalToConstant: markSize),
            mark.heightAnchor.constraint(equalToConstant: markSize),
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
            statusLabel.text = copy.text("shareExtension.notFound")
            return
        }

        var loaded = Array<String?>(repeating: nil, count: candidates.count)
        let group = DispatchGroup()
        for (index, candidate) in candidates.enumerated() {
            group.enter()
            candidate.0.loadItem(forTypeIdentifier: candidate.1) { value, _ in
                let text: String?
                if let url = value as? URL { text = url.absoluteString }
                else if let textValue = value as? String { text = textValue }
                else if let data = value as? Data { text = String(data: data, encoding: .utf8) }
                else { text = nil }
                DispatchQueue.main.async {
                    loaded[index] = text?.trimmed.nonEmpty
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
                self.statusLabel.text = self.copy.text("shareExtension.notFound")
            } else {
                self.statusLabel.text = self.copy.text("shareExtension.ready")
                self.openButton.isEnabled = true
            }
        }
    }

    @objc private func saveShare() {
        guard !finished, !saved, !trackingInput.isEmpty else { return }
        guard ShareInbox.save(SharedParcelDraft(label: parcelLabel, trackingInput: trackingInput)) else {
            statusLabel.text = copy.text("shareExtension.saveFailed")
            return
        }
        saved = true
        statusLabel.text = copy.text("shareExtension.saved")
        openButton.isHidden = true
        cancelButton.setTitle(copy.text("native.done"), for: .normal)
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
