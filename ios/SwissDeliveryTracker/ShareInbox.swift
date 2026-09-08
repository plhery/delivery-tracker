import Foundation
import UniformTypeIdentifiers

struct SharedParcelDraft: Codable, Identifiable, Equatable {
    let id: UUID
    let label: String
    let trackingInput: String
    let createdAt: Date

    init(id: UUID = UUID(), label: String = "", trackingInput: String, createdAt: Date = Date()) {
        self.id = id
        self.label = label
        self.trackingInput = trackingInput
        self.createdAt = createdAt
    }
}

enum ShareInbox {
    private static let key = "sdt.sharedParcelDraft"

    static var defaults: UserDefaults? {
        let group = Bundle.main.object(forInfoDictionaryKey: "SDTAppGroupIdentifier") as? String
            ?? "group.com.plhery.SwissDeliveryTracker"
        return UserDefaults(suiteName: group)
    }

    @discardableResult
    static func save(_ draft: SharedParcelDraft, defaults: UserDefaults? = defaults) -> Bool {
        guard let defaults, let data = try? JSONEncoder().encode(draft) else { return false }
        defaults.set(data, forKey: key)
        return defaults.data(forKey: key) == data
    }

    static func consume(defaults: UserDefaults? = defaults, now: Date = Date()) -> SharedParcelDraft? {
        guard let defaults, let data = defaults.data(forKey: key) else { return nil }
        // Consume malformed, legacy and expired drafts too; never replay them on another launch.
        defaults.removeObject(forKey: key)
        guard let draft = try? JSONDecoder().decode(SharedParcelDraft.self, from: data),
              (0...600).contains(now.timeIntervalSince(draft.createdAt)),
              !draft.trackingInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return draft
    }
}
