import XCTest
@testable import SwissDeliveryTracker

final class PeekMarkTests: XCTestCase {
    func testTheDrawingFollowsTheRenderedSize() {
        let expected: [(CGFloat, PeekMarkVariant)] = [
            (16, .glyph), (23.9, .glyph),
            (24, .simple), (28, .simple), (30, .simple), (40, .simple),
            (40.5, .full), (41, .full), (78, .full), (127.9, .full),
            (128, .fullWithLabel), (1024, .fullWithLabel),
        ]
        for (size, variant) in expected {
            XCTAssertEqual(PeekMarkVariant(size: size), variant, "\(size)")
        }
    }

    func testEveryDrawingStartsWithTheTileAndStaysInItsFrame() {
        let frame = CGRect(x: 0, y: 0, width: PeekMarkArtwork.frame, height: PeekMarkArtwork.frame)
        var counts: [PeekMarkVariant: Int] = [:]
        for variant in PeekMarkVariant.allCases {
            let layers = PeekMarkArtwork.layers(variant)
            counts[variant] = layers.count
            let tile = layers.first?.path.boundingBoxOfPath ?? .zero
            XCTAssertEqual(tile.minX, frame.minX, accuracy: 0.01)
            XCTAssertEqual(tile.minY, frame.minY, accuracy: 0.01)
            XCTAssertEqual(tile.maxX, frame.maxX, accuracy: 0.01)
            XCTAssertEqual(tile.maxY, frame.maxY, accuracy: 0.01)
            // Only the small lids reach past the frame, where the tile clips them.
            for layer in layers {
                XCTAssertTrue(frame.insetBy(dx: -24, dy: -24).contains(layer.path.boundingBoxOfPath), "\(variant)")
            }
        }
        // The tape comes with the full drawing, and the label with the icon sizes.
        XCTAssertLessThan(counts[.simple] ?? 0, counts[.full] ?? 0)
        XCTAssertEqual(counts[.fullWithLabel], (counts[.full] ?? 0) + 2)
    }
}
