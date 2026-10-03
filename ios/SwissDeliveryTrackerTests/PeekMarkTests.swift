import XCTest
@testable import SwissDeliveryTracker

final class PeekMarkTests: XCTestCase {
    private let frame = CGRect(x: 0, y: 0, width: PeekMarkArtwork.frame, height: PeekMarkArtwork.frame)
    private let layers = PeekMarkArtwork.layers

    func testTheDrawingStartsWithTheTileFillingTheFrame() throws {
        let tile = try XCTUnwrap(layers.first).path.boundingBoxOfPath
        XCTAssertEqual(tile.minX, frame.minX, accuracy: 0.01)
        XCTAssertEqual(tile.minY, frame.minY, accuracy: 0.01)
        XCTAssertEqual(tile.maxX, frame.maxX, accuracy: 0.01)
        XCTAssertEqual(tile.maxY, frame.maxY, accuracy: 0.01)
    }

    func testTheTileCarriesTwoEyesAndNothingElse() {
        XCTAssertEqual(layers.count, 7)
        // The whites of both eyes, then the pupil and the catchlight of the left eye and of the right one.
        let shapes: [(x: CGFloat, y: CGFloat, rx: CGFloat, ry: CGFloat)] = [
            (190, 262, 70, 77), (322, 262, 70, 77),
            (219.4, 269, 35, 35), (207.5, 255, 10.5, 10.5),
            (351.4, 269, 35, 35), (339.5, 255, 10.5, 10.5),
        ]
        for (layer, shape) in zip(layers.dropFirst(), shapes) {
            let box = layer.path.boundingBoxOfPath
            XCTAssertEqual(box.midX, shape.x, accuracy: 0.01)
            XCTAssertEqual(box.midY, shape.y, accuracy: 0.01)
            XCTAssertEqual(box.width / 2, shape.rx, accuracy: 0.01)
            XCTAssertEqual(box.height / 2, shape.ry, accuracy: 0.01)
        }
    }

    func testTheRightEyeIsTheLeftOne132UnitsFurtherRight() {
        let boxes = layers.map(\.path.boundingBoxOfPath)
        for (left, right) in [(boxes[1], boxes[2]), (boxes[3], boxes[5]), (boxes[4], boxes[6])] {
            XCTAssertEqual(right.midX - left.midX, 132, accuracy: 0.01)
            XCTAssertEqual(right.midY, left.midY, accuracy: 0.01)
            XCTAssertEqual(right.width, left.width, accuracy: 0.01)
            XCTAssertEqual(right.height, left.height, accuracy: 0.01)
        }
    }

    func testEachPupilAndCatchlightLieInsideTheirWhite() {
        for (white, inner) in [(layers[1], layers[3...4]), (layers[2], layers[5...6])] {
            for point in inner.flatMap(edge) {
                XCTAssertTrue(white.path.contains(point), "\(point)")
            }
        }
    }

    func testEveryLayerStaysInsideTheFrame() {
        for (index, layer) in layers.enumerated() {
            XCTAssertTrue(frame.insetBy(dx: -0.01, dy: -0.01).contains(layer.path.boundingBoxOfPath), "layer \(index)")
        }
    }

    func testTheTileIsYellowTheWhitesPaperAndEachPupilInkWithAWhiteCatchlight() {
        let pupil: [UInt32?] = [0x171714, 0xFFFFFF]
        XCTAssertEqual(layers.map { hex($0.color) }, [0xF3CF48, 0xFFFAF0, 0xFFFAF0] + pupil + pupil)
    }

    func testDrawingPaintsTheLayersBackToFrontWithYPointingDown() throws {
        let side = Int(PeekMarkArtwork.frame)
        let context = try XCTUnwrap(CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                              space: try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB)),
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        // A bitmap's y points up, so the first row of its memory is the top of the drawing once flipped.
        context.translateBy(x: 0, y: PeekMarkArtwork.frame)
        context.scaleBy(x: 1, y: -1)
        PeekMarkArtwork.draw(in: context, size: PeekMarkArtwork.frame)
        let bytes = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
        let clear: [UInt8] = [0, 0, 0, 0], yellow: [UInt8] = [0xF3, 0xCF, 0x48, 255], paper: [UInt8] = [0xFF, 0xFA, 0xF0, 255]
        let ink: [UInt8] = [0x17, 0x17, 0x14, 255], white: [UInt8] = [255, 255, 255, 255]
        // Outside the rounded corner, the tile, then the white, the pupil and the catchlight of each eye.
        var expected = [(2, 2, clear), (256, 60, yellow)]
        for eye in [0, 132] {
            expected += [(150 + eye, 262, paper), (225 + eye, 285, ink), (207 + eye, 255, white)]
        }
        // The left pupil stays whole where the right eye's white reaches over it.
        expected.append((253, 269, ink))
        for (x, y, color) in expected {
            for channel in 0..<4 {
                XCTAssertEqual(Int(bytes[(y * side + x) * 4 + channel]), Int(color[channel]), accuracy: 1, "(\(x), \(y)) channel \(channel)")
            }
        }
    }

    /// Points around the edge of a round layer.
    private func edge(of layer: PeekMarkArtwork.Layer) -> [CGPoint] {
        let box = layer.path.boundingBoxOfPath
        return stride(from: 0.0, to: 360, by: 15).map { degrees in
            let angle = degrees * .pi / 180
            return CGPoint(x: box.midX + cos(angle) * box.width / 2, y: box.midY + sin(angle) * box.height / 2)
        }
    }

    /// An opaque sRGB colour as 0xRRGGBB.
    private func hex(_ color: CGColor) -> UInt32? {
        guard color.colorSpace?.name == CGColorSpace.sRGB, let parts = color.components,
              parts.count == 4, parts[3] == 1 else { return nil }
        return parts.prefix(3).reduce(0) { $0 << 8 | UInt32(($1 * 255).rounded()) }
    }
}
