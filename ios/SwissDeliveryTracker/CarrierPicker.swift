import SwiftUI

/// What the carrier pickers show: search over names, other names and countries,
/// the A–Z sections, and the carriers someone used before. Mirrors
/// `src/lib/carrierPicker.ts`.
enum CarrierPickerSearch {
    struct Result: Equatable {
        let carrier: CarrierID
        let score: Double
        /// Character offsets of the query in the name, when the name itself matched.
        let highlight: Range<Int>?
        /// The other name that matched, when only that name did.
        let alias: String?
    }

    struct LetterSection: Equatable {
        let letter: String
        let carriers: [CarrierID]
    }

    /// Lower case without accents, one character for each character, so a match can be highlighted.
    static func fold(_ value: String) -> String {
        String(value.map { character in
            let folded = String(character).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            return folded.count == 1 ? folded.first! : character
        })
    }

    private static func isLetterOrDigit(_ character: Character) -> Bool {
        character.isLetter || character.isNumber
    }

    private static func compact(_ value: String) -> String {
        String(fold(value).filter(isLetterOrDigit))
    }

    /// The first match of `query` in `text`, as a character offset; only one that starts a word when asked.
    private static func offset(of query: String, in text: String, startingWord: Bool) -> Int? {
        let characters = Array(text)
        let needle = Array(query)
        guard !needle.isEmpty, needle.count <= characters.count else { return nil }
        for index in 0...(characters.count - needle.count) where Array(characters[index..<index + needle.count]) == needle {
            if !startingWord || index == 0 || !isLetterOrDigit(characters[index - 1]) { return index }
        }
        return nil
    }

    static func match(
        _ carrier: CarrierID,
        definition: CarrierDefinition,
        query: String,
        countryNames: (String) -> [String]
    ) -> Result? {
        let folded = fold(query.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !folded.isEmpty else { return nil }
        let squeezed = compact(query)
        let name = fold(definition.displayName)
        let aliases = definition.aliases ?? []
        func lit(_ start: Int, _ score: Double) -> Result {
            Result(carrier: carrier, score: score, highlight: start..<start + folded.count, alias: nil)
        }
        func plain(_ score: Double, alias: String? = nil) -> Result {
            Result(carrier: carrier, score: score, highlight: nil, alias: alias)
        }
        if name.hasPrefix(folded) { return lit(0, 0) }
        if let word = offset(of: folded, in: name, startingWord: true), word > 0 { return lit(word, 1) }
        if !squeezed.isEmpty, compact(definition.displayName).hasPrefix(squeezed) { return plain(1.5) }
        if let alias = aliases.first(where: {
            offset(of: folded, in: fold($0), startingWord: true) != nil || (!squeezed.isEmpty && compact($0).hasPrefix(squeezed))
        }) {
            return plain(2, alias: alias)
        }
        if let inside = offset(of: folded, in: name, startingWord: false), inside > 0 { return lit(inside, 3) }
        if squeezed.count > 1, compact(definition.displayName).contains(squeezed) { return plain(3.5) }
        if let alias = aliases.first(where: { fold($0).contains(folded) }) { return plain(4, alias: alias) }
        let inCountry = (definition.countries ?? []).contains { code in
            countryNames(code).contains { offset(of: folded, in: fold($0), startingWord: true) != nil }
        }
        return inCountry ? plain(5) : nil
    }

    /// Carriers matching a query, best first: the name's start, a word in it, an
    /// other name ("Colissimo", "Hugger"), anywhere in the name, then a country.
    /// The carriers that fit the number rank a little higher.
    static func search(
        _ query: String,
        catalog: CarrierCatalog,
        language: AppLanguage,
        preferred: Set<CarrierID> = []
    ) -> [Result] {
        let names = countryNames(language)
        return catalog.selectableCarriers.compactMap { carrier -> Result? in
            let definition = catalog.info(for: carrier, language: language)
            guard let found = match(carrier, definition: definition, query: query, countryNames: names) else { return nil }
            return Result(carrier: carrier, score: found.score - (preferred.contains(carrier) ? 0.3 : 0),
                          highlight: found.highlight, alias: found.alias)
        }
        .sorted { left, right in
            if left.score != right.score { return left.score < right.score }
            return compare(catalog.info(for: left.carrier, language: language).displayName,
                           catalog.info(for: right.carrier, language: language).displayName, language) == .orderedAscending
        }
    }

    /// Every name a country is searched by: the reader's and the English one.
    static func countryNames(_ language: AppLanguage) -> (String) -> [String] {
        { code in
            let local = TrackingLocation.countryName(code, language: language)
            let english = TrackingLocation.countryName(code, language: .en)
            return local == english ? [local] : [local, english]
        }
    }

    private static func compare(_ left: String, _ right: String, _ language: AppLanguage) -> ComparisonResult {
        left.compare(right, options: [.caseInsensitive, .diacriticInsensitive, .numeric], locale: language.locale)
    }

    /// Carriers by initial, in the reader's alphabet; names starting with a digit come last under "#".
    static func letterSections(catalog: CarrierCatalog, language: AppLanguage) -> [LetterSection] {
        let sorted = catalog.selectableCarriers.sorted {
            compare(catalog.info(for: $0, language: language).displayName,
                    catalog.info(for: $1, language: language).displayName, language) == .orderedAscending
        }
        var sections: [LetterSection] = []
        var other: [CarrierID] = []
        for carrier in sorted {
            let letter = fold(String(catalog.info(for: carrier, language: language).displayName.prefix(1)))
                .uppercased(with: language.locale)
            guard letter.count == 1, letter.first?.isLetter == true else {
                other.append(carrier)
                continue
            }
            if sections.last?.letter == letter {
                sections[sections.count - 1] = LetterSection(letter: letter, carriers: sections[sections.count - 1].carriers + [carrier])
            } else {
                sections.append(LetterSection(letter: letter, carriers: [carrier]))
            }
        }
        return other.isEmpty ? sections : sections + [LetterSection(letter: "#", carriers: other)]
    }

    /// The countries line under a carrier: its first two countries, with how many
    /// more. Networks across many countries (Amazon) show none; the line would not
    /// tell them apart.
    static func countryLine(_ countries: [String], name: (String) -> String) -> String {
        guard !countries.isEmpty, countries.count <= 5 else { return "" }
        let names = countries.prefix(2).map(name).joined(separator: " · ")
        return countries.count > 2 ? "\(names) +\(countries.count - 2)" : names
    }

    /// The carriers of someone's latest parcels, newest first, each once.
    static func usedCarriers(_ parcels: [Parcel], catalog: CarrierCatalog, limit: Int = 3) -> [CarrierID] {
        var used: [CarrierID] = []
        for parcel in parcels.sorted(by: { $0.createdAt > $1.createdAt }) where used.count < limit {
            if catalog.info(for: parcel.carrier).selectable, !used.contains(parcel.carrier) { used.append(parcel.carrier) }
        }
        return used
    }
}

/// Choose one of the catalog's carriers: automatic detection first when it is
/// offered, then the sections the caller passes (the carriers that fit the
/// number, the ones used before), then every carrier from A to Z with a letter
/// index. Searching covers names, other names and countries.
///
/// The sections keep the order they opened with: an answer that arrives while
/// the list is open only changes tags and the automatic row's text, so nothing
/// moves under the reader's finger.
struct CarrierPickerView: View {
    struct PickerSection: Identifiable, Equatable {
        let id: String
        let title: String
        let carriers: [CarrierID]
    }

    struct Tag: Equatable {
        let label: String
        /// A carrier that knows the number, rather than one still being asked.
        let found: Bool
    }

    struct Automatic: Equatable {
        let description: String
        let recommended: Bool
        let busy: Bool
    }

    /// Nil while automatic detection is chosen.
    let selection: CarrierID?
    let automatic: Automatic?
    let tags: [CarrierID: Tag]
    let onSelect: (CarrierID?) -> Void

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var catalog = CarrierCatalog.shared
    @State private var query = ""
    @State private var openingSections: [PickerSection]

    init(
        selection: CarrierID?,
        automatic: Automatic? = nil,
        sections: [PickerSection],
        tags: [CarrierID: Tag] = [:],
        onSelect: @escaping (CarrierID?) -> Void
    ) {
        self.selection = selection
        self.automatic = automatic
        self.tags = tags
        self.onSelect = onSelect
        _openingSections = State(initialValue: sections.filter { !$0.carriers.isEmpty })
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if trimmedQuery.isEmpty {
                    if let automatic {
                        Section { automaticRow(automatic) }
                    }
                    ForEach(openingSections) { section in
                        Section(section.title) {
                            ForEach(section.carriers) { carrier in row(carrier) }
                        }
                    }
                    ForEach(letterSections, id: \.letter) { section in
                        Section {
                            ForEach(section.carriers) { carrier in row(carrier) }
                        } header: {
                            Text(section.letter)
                        }
                        .id(Self.letterID(section.letter))
                    }
                } else if results.isEmpty {
                    Section {
                        Text(localizer.text("picker.empty", ["query": trimmedQuery]))
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section(localizer.text("picker.results.many", ["count": results.count])) {
                        ForEach(results, id: \.carrier) { result in
                            row(result.carrier, highlight: result.highlight, alias: result.alias)
                        }
                    }
                }
            }
            // Rows keep clear of the letter rail's touch strip.
            .contentMargins(.trailing, trimmedQuery.isEmpty ? LetterRail.width : 20, for: .scrollContent)
            .overlay(alignment: .trailing) {
                if trimmedQuery.isEmpty {
                    LetterRail(letters: letterSections.map(\.letter), label: localizer.text("picker.jump")) { letter in
                        proxy.scrollTo(Self.letterID(letter), anchor: .top)
                    }
                }
            }
        }
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: localizer.text("picker.search", ["count": catalog.selectableCarriers.count])
        )
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .navigationTitle(localizer.text("add.carrier"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private static func letterID(_ letter: String) -> String { "letter:\(letter)" }

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var results: [CarrierPickerSearch.Result] {
        CarrierPickerSearch.search(trimmedQuery, catalog: catalog, language: localizer.language,
                                   preferred: Set(openingSections.first?.carriers ?? []))
    }

    private var letterSections: [CarrierPickerSearch.LetterSection] {
        CarrierPickerSearch.letterSections(catalog: catalog, language: localizer.language)
    }

    private func choose(_ carrier: CarrierID?) {
        onSelect(carrier)
        dismiss()
    }

    private func automaticRow(_ automatic: Automatic) -> some View {
        Button { choose(nil) } label: {
            HStack(spacing: 12) {
                Group {
                    if automatic.busy {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "wand.and.sparkles")
                            .foregroundStyle(ExperimentalPalette.ochre)
                    }
                }
                .frame(width: 27)
                VStack(alignment: .leading, spacing: 3) {
                    Text(localizer.text("add.detect"))
                        .foregroundStyle(Brand.ink)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        if automatic.recommended {
                            tag(localizer.text("picker.recommended"), found: false)
                        }
                        Text(automatic.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                if selection == nil { checkmark }
            }
            .contentShape(Rectangle())
        }
        .listRowBackground(selection == nil ? ExperimentalPalette.ochreSurface : nil)
        .accessibilityAddTraits(selection == nil ? .isSelected : [])
        .accessibilityIdentifier("carrierPicker.automatic")
    }

    private func row(_ carrier: CarrierID, highlight: Range<Int>? = nil, alias: String? = nil) -> some View {
        let definition = catalog.info(for: carrier, language: localizer.language)
        let subtitle = alias.map { localizer.text("picker.alias", ["name": $0]) }
            ?? CarrierPickerSearch.countryLine(definition.countries ?? []) {
                TrackingLocation.countryName($0, language: localizer.language)
            }
        let selected = selection == carrier
        return Button { choose(carrier) } label: {
            HStack(spacing: 12) {
                CarrierTruckMark(identity: CarrierVisualIdentity.of(carrier, language: localizer.language))
                VStack(alignment: .leading, spacing: 2) {
                    Text(highlighted(definition.displayName, highlight))
                        .foregroundStyle(Brand.ink)
                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                if let tag = tags[carrier] { self.tag(tag.label, found: tag.found) }
                if selected { checkmark }
            }
            .contentShape(Rectangle())
        }
        .listRowBackground(selected ? ExperimentalPalette.ochreSurface : nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(definition.displayName)
        .accessibilityValue([subtitle, tags[carrier]?.label ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    private var checkmark: some View {
        Image(systemName: "checkmark")
            .font(.body.weight(.semibold))
            .foregroundStyle(ExperimentalPalette.ochre)
            .accessibilityHidden(true)
    }

    private func tag(_ label: String, found: Bool) -> some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(found ? ExperimentalPalette.delivered : Color.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(found ? ExperimentalPalette.deliveredSurface : Brand.cream, in: Capsule())
            .fixedSize()
    }

    private func highlighted(_ name: String, _ range: Range<Int>?) -> AttributedString {
        var attributed = AttributedString(name)
        guard let range, range.upperBound <= name.count else { return attributed }
        let start = attributed.characters.index(attributed.startIndex, offsetBy: range.lowerBound)
        let end = attributed.characters.index(start, offsetBy: range.count)
        attributed[start..<end].backgroundColor = Brand.accent.opacity(0.45)
        attributed[start..<end].font = .body.weight(.semibold)
        return attributed
    }
}

/// The A–Z beside the list. The system's section index answers only a thin
/// strip at the screen's edge; this one takes a thumb-wide strip, jumps as soon
/// as it is pressed and follows a finger sliding along it, one tick per letter,
/// with the letter shown beside the finger.
struct LetterRail: View {
    let letters: [String]
    let label: String
    let onLetter: (String) -> Void

    @State private var current: String?
    @State private var announced = 0

    /// Apple's minimum touch target; the letters sit near the edge inside it.
    static let width: CGFloat = 44
    private static let padding: CGFloat = 12

    var body: some View {
        GeometryReader { geometry in
            let available = geometry.size.height - Self.padding * 2
            let rowHeight = min(16, max(8, available / CGFloat(max(letters.count, 1))))
            VStack(spacing: 0) {
                ForEach(letters, id: \.self) { letter in
                    Text(letter)
                        .font(.system(size: min(11, rowHeight * 0.72), weight: .semibold))
                        .foregroundStyle(letter == current ? Brand.background : ExperimentalPalette.ochre)
                        .frame(width: 20, height: rowHeight)
                        .background {
                            if letter == current {
                                RoundedRectangle(cornerRadius: 5).fill(ExperimentalPalette.ochre)
                            }
                        }
                }
            }
            .padding(.trailing, 4)
            .padding(.vertical, Self.padding)
            .frame(width: Self.width, alignment: .trailing)
            .contentShape(Rectangle())
            .overlay(alignment: .topLeading) { bubble(rowHeight: rowHeight) }
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in select(Int(((value.location.y - Self.padding) / rowHeight).rounded(.down))) }
                    .onEnded { _ in current = nil }
            )
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .trailing)
        }
        .frame(width: Self.width)
        .sensoryFeedback(.selection, trigger: current) { _, letter in letter != nil }
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue(letters.indices.contains(announced) ? letters[announced] : "")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: announced = min(announced + 1, letters.count - 1)
            case .decrement: announced = max(announced - 1, 0)
            @unknown default: return
            }
            if letters.indices.contains(announced) { onLetter(letters[announced]) }
        }
    }

    private func select(_ index: Int) {
        guard !letters.isEmpty else { return }
        // Past either end the first or last letter holds.
        let letter = letters[min(max(index, 0), letters.count - 1)]
        guard letter != current else { return }
        current = letter
        onLetter(letter)
    }

    @ViewBuilder
    private func bubble(rowHeight: CGFloat) -> some View {
        if let current, let index = letters.firstIndex(of: current) {
            Text(current)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Brand.background)
                .frame(width: 52, height: 52)
                .background(Brand.ink, in: Circle())
                .offset(x: -64, y: Self.padding + CGFloat(index) * rowHeight + rowHeight / 2 - 26)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}
