import SwiftUI

/// The mark at a size in points, in the drawing that size calls for. Decorative: the name is written beside it.
struct PeekMark: View {
    let size: CGFloat

    var body: some View {
        let layers = PeekMarkArtwork.layers(PeekMarkVariant(size: size))
        let scale = CGAffineTransform(scaleX: size / PeekMarkArtwork.frame, y: size / PeekMarkArtwork.frame)
        ZStack {
            ForEach(layers.indices, id: \.self) { index in
                Path(layers[index].path).applying(scale).fill(Color(cgColor: layers[index].color))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * PeekMarkArtwork.cornerRadius / PeekMarkArtwork.frame))
        .accessibilityHidden(true)
    }
}
