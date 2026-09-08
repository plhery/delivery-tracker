import CoreMotion
import SwiftUI
import UIKit

/// A small, bounded pose relative to how the phone was held on arrival.
struct ArrivalTilt: Equatable, Sendable {
    var x: Double = 0
    var y: Double = 0

    mutating func follow(roll: Double, pitch: Double, accelerationX: Double = 0, accelerationY: Double = 0, quarterTurns: Int = 0) {
        guard roll.isFinite, pitch.isFinite, accelerationX.isFinite, accelerationY.isFinite else { return }
        // Device motion separates gravity from translation: a small inertial
        // response makes the paper feel weighted even without rotating the phone.
        let horizontalInput = roll / 0.36 + min(1, max(-1, accelerationX * 2)) * 0.16
        let verticalInput = pitch / 0.36 - min(1, max(-1, accelerationY * 2)) * 0.16
        let angle = Double(quarterTurns) * .pi / 2
        let horizontal = horizontalInput * cos(angle) + verticalInput * sin(angle)
        let vertical = verticalInput * cos(angle) - horizontalInput * sin(angle)
        // A low-pass filter removes hand tremor; output can never exceed ±1.
        x += (min(1, max(-1, horizontal)) - x) * 0.22
        y += (min(1, max(-1, vertical)) - y) * 0.22
    }
}

@MainActor
final class ArrivalMotion: ObservableObject {
    @Published private(set) var tilt = ArrivalTilt()
    private let manager = CMMotionManager()
    private var samples: Task<Void, Never>?
    private var reference: CMAttitude?
    private var orientation: UIInterfaceOrientation?

    func setActive(_ active: Bool) {
        samples?.cancel()
        samples = nil
        manager.stopDeviceMotionUpdates()
        reference = nil
        orientation = nil
        tilt = ArrivalTilt()
        guard active, manager.isDeviceMotionAvailable else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 30
        manager.showsDeviceMovementDisplay = false
        manager.startDeviceMotionUpdates(using: .xArbitraryZVertical)
        samples = Task { [weak self] in
            while !Task.isCancelled {
                self?.sample()
                do { try await Task.sleep(for: .milliseconds(33)) }
                catch { return }
            }
        }
    }

    private func sample() {
        guard let sample = manager.deviceMotion else { return }
        let attitude = sample.attitude
        let currentOrientation = (UIApplication.shared.connectedScenes
            .first { $0.activationState == .foregroundActive } as? UIWindowScene)?.interfaceOrientation ?? .portrait
        if orientation != currentOrientation {
            orientation = currentOrientation
            reference = nil
            tilt = ArrivalTilt()
        }
        guard let reference else {
            reference = attitude.copy() as? CMAttitude
            return
        }
        guard let relative = attitude.copy() as? CMAttitude else { return }
        relative.multiply(byInverseOf: reference)
        let turns = currentOrientation == .landscapeLeft ? 1 : currentOrientation == .landscapeRight ? -1 : currentOrientation == .portraitUpsideDown ? 2 : 0
        var next = tilt
        next.follow(roll: relative.roll, pitch: relative.pitch,
                    accelerationX: sample.userAcceleration.x, accelerationY: sample.userAcceleration.y,
                    quarterTurns: turns)
        if abs(next.x - tilt.x) + abs(next.y - tilt.y) > 0.0005 { tilt = next }
    }

    deinit {
        samples?.cancel()
        manager.stopDeviceMotionUpdates()
    }
}
