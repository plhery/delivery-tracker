import Foundation
import UIKit

enum DeliveryAPIError: LocalizedError {
    case authenticationExpired
    case duplicateTracking(UUID)
    case invalidResponse
    case labelTooLong
    case notificationsDenied
    case parcelMissing
    case pushTokenUnavailable
    case refreshFailed
    case refreshTimeout
    case rateLimited(TimeInterval)
    case service(String)
    case serviceFailed(Int)

    var errorDescription: String? {
        switch self {
        case .authenticationExpired: "Your sign-in expired. Please sign in again."
        case .duplicateTracking: "This tracking number is already in your delivery box."
        case .invalidResponse: "The delivery service returned an invalid response."
        case .labelTooLong: "Parcel names can be at most 80 characters."
        case .notificationsDenied: "Notifications were not allowed."
        case .parcelMissing: "This parcel is no longer in your delivery box."
        case .pushTokenUnavailable: "Apple did not return a notification token. Try again on a signed development build."
        case .refreshFailed: "Tracking refresh failed. Try again."
        case .refreshTimeout: "The tracking refresh is taking longer than expected."
        case .rateLimited: "Too many requests. Try again shortly."
        case .service(let message): message
        case .serviceFailed(let status): "Delivery service failed (\(status))."
        }
    }
}

@MainActor
final class DeliveryAPIClient {
    private let configuration: AppConfiguration
    private unowned let session: SessionStore

    init(configuration: AppConfiguration, session: SessionStore) {
        self.configuration = configuration
        self.session = session
    }

    func listPackages() async throws -> [Parcel] {
        let response: PackageListResponse = try await request("/api/packages?includeArchived=true")
        return response.packages
    }

    func add(_ input: CreatePackageRequest) async throws -> CreatePackageResponse {
        try await request("/api/packages", method: "POST", body: input)
    }

    func rename(id: UUID, label: String) async throws -> Parcel {
        try await request(
            "/api/packages/\(id.uuidString)",
            method: "PATCH",
            body: RenamePackageRequest(label: label)
        )
    }

    func changeCarrier(
        id: UUID,
        carrier: CarrierID,
        trackingURL: String?,
        dpdPostcode: String?
    ) async throws -> ChangePackageCarrierResponse {
        try await request(
            "/api/packages/\(id.uuidString)/carrier",
            method: "PATCH",
            body: ChangePackageCarrierRequest(
                carrier: carrier,
                trackingURL: trackingURL,
                dpdPostcode: dpdPostcode
            )
        )
    }

    func setMuted(id: UUID, muted: Bool) async throws -> Parcel {
        try await request(
            "/api/packages/\(id.uuidString)/notifications",
            method: "PATCH",
            body: PackageNotificationRequest(muted: muted)
        )
    }

    func archive(id: UUID) async throws {
        let _: OKResponse = try await request("/api/packages/\(id.uuidString)", method: "DELETE")
    }

    func restore(id: UUID) async throws -> Parcel {
        try await request("/api/packages/\(id.uuidString)/restore", method: "POST")
    }

    func permanentlyDelete(id: UUID) async throws {
        let _: OKResponse = try await request(
            "/api/packages/\(id.uuidString)/permanent",
            method: "DELETE"
        )
    }

    func refreshAll() async throws {
        let queued: QueueResponse = try await request("/api/sync", method: "POST")
        try await waitForJobs(queued.jobIDs)
    }

    func refresh(id: UUID) async throws {
        let queued: QueueResponse = try await request(
            "/api/packages/\(id.uuidString)/sync",
            method: "POST"
        )
        try await waitForJobs(queued.jobIDs)
    }

    func waitForJobs(_ jobIds: [UUID]) async throws {
        var pending = Set(jobIds)
        let deadline = Date().addingTimeInterval(120)
        var interval: TimeInterval = 1
        while !pending.isEmpty && Date() < deadline {
            try Task.checkCancellation()
            var retryAfter: TimeInterval = 0
            do {
                let ids = Array(pending.prefix(20))
                let query = ids.map(\.uuidString).joined(separator: ",")
                let response: SyncJobListResponse = try await request("/api/sync/jobs?ids=\(query)")
                guard Set(response.jobs.map(\.id)) == Set(ids) else {
                    throw DeliveryAPIError.invalidResponse
                }
                for job in response.jobs {
                    if job.status == .failed || (job.result?.errors ?? 0) > 0 {
                        if let error = job.error { throw DeliveryAPIError.service(error) }
                        throw DeliveryAPIError.refreshFailed
                    }
                    if job.status == .succeeded { pending.remove(job.id) }
                }
            } catch DeliveryAPIError.rateLimited(let seconds) {
                retryAfter = seconds
            }
            if pending.isEmpty { return }
            try await Task.sleep(for: .seconds(min(max(interval, retryAfter), max(0, deadline.timeIntervalSinceNow))))
            interval = min(interval * 1.5, 10)
        }
        if !pending.isEmpty { throw DeliveryAPIError.refreshTimeout }
    }

    func notificationPreferences() async throws -> NotificationPreferences {
        try await request("/api/push/preferences")
    }

    func saveNotificationPreferences(_ value: NotificationPreferences) async throws -> NotificationPreferences {
        try await request("/api/push/preferences", method: "PATCH", body: value)
    }

    func registerNativePushToken(
        _ token: String,
        installationID: UUID,
        language: AppLanguage,
        sendTest: Bool
    ) async throws -> Bool {
        #if DEBUG
        let environment = NativePushEnvironment.development
        #else
        let environment = NativePushEnvironment.production
        #endif
        let response: PushSubscriptionResponse = try await request(
            "/api/push/devices",
            method: "POST",
            body: NativePushDeviceRequest(
                token: token,
                installationID: installationID,
                environment: environment,
                locale: NativePushLocale(rawValue: language.rawValue) ?? .en,
                deviceName: UIDevice.current.name,
                sendTest: sendTest
            )
        )
        return response.testSent
    }

    func unregisterNativePushToken(_ token: String) async throws {
        let _: OKResponse = try await request(
            "/api/push/devices",
            method: "DELETE",
            body: DeleteNativePushDeviceRequest(token: token)
        )
    }

    func registerLiveActivityDevice(
        token: String,
        installationID: UUID,
        language: AppLanguage
    ) async throws {
        #if DEBUG
        let environment = NativePushEnvironment.development
        #else
        let environment = NativePushEnvironment.production
        #endif
        let _: OKResponse = try await request(
            "/api/live-activities/devices",
            method: "POST",
            body: LiveActivityDeviceRequest(
                installationID: installationID,
                token: token,
                environment: environment,
                locale: NativePushLocale(rawValue: language.rawValue) ?? .en
            )
        )
    }

    func unregisterLiveActivityDevice(installationID: UUID) async throws {
        let _: OKResponse = try await request(
            "/api/live-activities/devices",
            method: "DELETE",
            body: DeleteLiveActivityDeviceRequest(installationID: installationID)
        )
    }

    func registerLiveActivityUpdateToken(
        activityID: String,
        parcelID: UUID,
        token: String,
        installationID: UUID,
        language: AppLanguage
    ) async throws {
        #if DEBUG
        let environment = NativePushEnvironment.development
        #else
        let environment = NativePushEnvironment.production
        #endif
        let _: OKResponse = try await request(
            "/api/live-activities/activities",
            method: "POST",
            body: LiveActivityUpdateTokenRequest(
                installationID: installationID,
                activityID: activityID,
                parcelID: parcelID,
                token: token,
                environment: environment,
                locale: NativePushLocale(rawValue: language.rawValue) ?? .en
            )
        )
    }

    func unregisterLiveActivityUpdateToken(
        activityID: String,
        installationID: UUID
    ) async throws {
        let _: OKResponse = try await request(
            "/api/live-activities/activities",
            method: "DELETE",
            body: DeleteLiveActivityUpdateTokenRequest(
                installationID: installationID,
                activityID: activityID
            )
        )
    }

    func exportAccount() async throws -> Data {
        try await rawRequest("/api/account/export").0
    }

    func deleteAccount(confirmation: String) async throws {
        let _: OKResponse = try await request(
            "/api/account",
            method: "DELETE",
            body: DeleteAccountRequest(confirmation: confirmation)
        )
    }

    private func request<T: Decodable, Body: Encodable>(
        _ path: String,
        method: String = "GET",
        body: Body?
    ) async throws -> T {
        let encoded = try body.map { try JSONEncoder.deliveryTracker.encode($0) }
        let (data, _) = try await rawRequest(path, method: method, body: encoded)
        do {
            return try JSONDecoder.deliveryTracker.decode(T.self, from: data)
        } catch {
            throw DeliveryAPIError.invalidResponse
        }
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET"
    ) async throws -> T {
        try await request(path, method: method, body: Optional<String>.none)
    }

    private func rawRequest(
        _ path: String,
        method: String = "GET",
        body: Data? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: path, relativeTo: configuration.apiBaseURL)?.absoluteURL else {
            throw DeliveryAPIError.invalidResponse
        }

        func perform(token: String?) async throws -> (Data, HTTPURLResponse) {
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.httpBody = body
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            request.timeoutInterval = 30
            request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
            if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw DeliveryAPIError.invalidResponse }
            return (data, http)
        }

        var token = try await session.accessToken()
        var result = try await perform(token: token)
        if result.1.statusCode == 401 || result.1.statusCode == 403 {
            token = try? await session.accessToken(forceRefresh: true)
            if token != nil { result = try await perform(token: token) }
        }
        if result.1.statusCode == 401 || result.1.statusCode == 403 {
            session.forceSignOut()
            throw DeliveryAPIError.authenticationExpired
        }
        guard (200..<300).contains(result.1.statusCode) else {
            if result.1.statusCode == 429 {
                throw DeliveryAPIError.rateLimited(Self.retryAfterSeconds(
                    result.1.value(forHTTPHeaderField: "Retry-After")
                ))
            }
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: result.0)
            if result.1.statusCode == 409, let packageID = error?.packageID {
                throw DeliveryAPIError.duplicateTracking(packageID)
            }
            if let message = error?.error { throw DeliveryAPIError.service(message) }
            throw DeliveryAPIError.serviceFailed(result.1.statusCode)
        }
        return result
    }

    static func retryAfterSeconds(_ value: String?, now: Date = Date()) -> TimeInterval {
        guard let value else { return 0 }
        if let seconds = TimeInterval(value), seconds.isFinite { return max(0, seconds) }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return max(0, formatter.date(from: value)?.timeIntervalSince(now) ?? 0)
    }
}
