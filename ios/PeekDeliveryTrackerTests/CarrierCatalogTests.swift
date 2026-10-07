import XCTest
@testable import PeekDeliveryTracker

final class CarrierCatalogTests: XCTestCase {
    func testDiscoveryIncludesBrowserCandidatesWithoutChangingHTTPRecognition() {
        let http = catalog.recognitionCandidates(for: "000000000011")
        XCTAssertTrue(http.contains(.colisPrive))
        XCTAssertFalse(http.contains(.fedex))
        XCTAssertEqual(catalog.discoveryCandidates(for: "000000000011"), http + [.fedex])
        XCTAssertEqual(catalog.recognitionCandidates(for: "33870000000000001", browser: true), [.dhlEcommerce])
        XCTAssertEqual(catalog.discoveryCandidates(for: "1Z999AA10123456784"), [])
    }
    func testMondialRelayLabelBarcodeDetectionAndPublicLink() throws {
        // Published example in Mondial Relay's label specification, not customer data.
        let barcode = "12123456780101006623123454"
        XCTAssertEqual(catalog.detect(barcode).carrier, .mondialRelay)
        XCTAssertEqual(catalog.detect(barcode).confidence, .high)
        XCTAssertEqual(catalog.parse("Mon colis: \(barcode)").trackingNumber, barcode)
        XCTAssertTrue(catalog.requirements(for: .mondialRelay, trackingNumber: barcode).isEmpty)
        for invalid in ["00000000000000000000000000", "12123456780101106623123454", "12123456780101006623123455"] {
            XCTAssertNotEqual(catalog.detect(invalid).carrier, .mondialRelay)
        }
        let parcel = Parcel(id: UUID(), trackingNumber: barcode, label: "Example", carrier: .mondialRelay,
            createdAt: "2026-09-10T12:00:00Z", syncStatus: .ok, notificationsMuted: false)
        XCTAssertEqual(try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .fr).first).url.absoluteString,
            "https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=121234567801")
    }

    func testCourierGuyProductTrackingLinks() throws {
        for (number, native) in [("LD000001", "LD-000001"), ("DD000001", "DD-000001")] {
            let parcel = Parcel(id: UUID(), trackingNumber: number, label: "Example", carrier: .theCourierGuy,
                createdAt: "2026-09-10T12:00:00Z", syncStatus: .ok, notificationsMuted: false)
            let link = try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .en).first)
            let query = URLComponents(url: link.url, resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(query?.first(where: { $0.name == "ref" })?.value, native)
        }
    }

    func testLinksFollowWorkingUniversalAndReturnToDirectOnRecovery() throws {
        var parcel = Parcel(id: UUID(), trackingNumber: "TEST1234", label: "Test", carrier: .dhl,
            createdAt: "2026-09-10T12:00:00Z", syncStatus: .ok, notificationsMuted: false)
        let providers = [
            ("17TRACK", "https://t.17track.net/fr#nums=TEST1234"),
            ("ParcelsApp", "https://parcelsapp.com/fr/tracking/TEST1234"),
            ("Ship24", "https://www.ship24.com/tracking?p=TEST1234"),
            ("UPU", "https://globaltracktrace.ptc.post/gtt.web/Search.aspx"),
            ("Postal Ninja", "https://postal.ninja/en/track"),
        ]
        for (provider, expected) in providers {
            parcel.carrierData = CarrierData(trackingProvider: provider)
            let link = try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .fr).first)
            XCTAssertEqual(link.name, provider)
            XCTAssertEqual(link.url.absoluteString, expected)
        }
        parcel.carrierData = CarrierData(activeTrackingCarrier: .ups)
        parcel.trackingURL = "https://www.dhl.de/old-capability"
        let recovered = try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .fr).first)
        XCTAssertEqual(recovered.carrier, .ups)
        XCTAssertTrue(recovered.url.absoluteString.contains("ups.com"))
        // The carrier answered the same check: its link stays, whoever supplied the result.
        parcel.trackingURL = nil
        parcel.carrierData = CarrierData(trackingProvider: "Ship24", carrierAnswered: true)
        let answered = catalog.trackingLinks(for: parcel, language: .fr)
        XCTAssertEqual(answered.map(\.carrier), [.dhl])
        XCTAssertFalse(answered[0].url.absoluteString.contains("ship24"))
    }

    func testUniversalUsesLocalNumberAndKeepsOriginLink() throws {
        let parcel = Parcel(id: UUID(), trackingNumber: "ORIGIN1234", label: "Test", carrier: .dhl,
            createdAt: "2026-09-10T12:00:00Z", syncStatus: .ok,
            carrierData: CarrierData(activeTrackingCarrier: .swissPost, activeTrackingNumber: "LOCAL1234",
                originalCarrier: .dhl, originalTrackingNumber: "ORIGIN1234", trackingProvider: "Ship24"),
            notificationsMuted: false)
        let links = catalog.trackingLinks(for: parcel, language: .fr)
        XCTAssertEqual(links.map(\.name), ["Ship24", "DHL"])
        XCTAssertEqual(links.map(\.role), [.active, .history])
        XCTAssertTrue(links[0].url.absoluteString.contains("LOCAL1234"))
        XCTAssertTrue(links[1].url.absoluteString.contains("ORIGIN1234"))
    }

    // Exercise the bundled rules without inheriting a previously cached live catalog.
    private let catalog = CarrierCatalog(cacheURL: nil)

    func testLinkedGLSParcelKeepsOriginalIdentityAndSwissPostPrimaryLink() throws {
        let parcel = Parcel(
            id: UUID(), trackingNumber: "993412345612345678", label: "Perfume / Surprise",
            carrier: .swissPost, createdAt: "2026-09-10T07:00:00Z", syncStatus: .ok,
            carrierData: CarrierData(originalCarrier: .glsDe, originalTrackingNumber: "12345678901"),
            notificationsMuted: false
        )
        XCTAssertEqual(parcel.displayedCarrier, .glsDe)
        XCTAssertEqual(parcel.activeTrackingCarrier, .swissPost)
        let links = catalog.trackingLinks(for: parcel, language: .fr)
        XCTAssertEqual(links.map(\.carrier), [.swissPost, .glsDe])
        XCTAssertEqual(links.map(\.role), [.active, .history])
        XCTAssertTrue(links[0].url.absoluteString.contains("993412345612345678"))
        XCTAssertTrue(links[1].url.absoluteString.contains("12345678901"))
    }

    func testDHLHandoffUsesSwissPostURLWhileKeepingDHLHistory() {
        let parcel = Parcel(
            id: UUID(), trackingNumber: "LF123456785DE", label: "Garden cable",
            carrier: .dhl, createdAt: "2026-09-10T07:00:00Z", syncStatus: .ok,
            trackingURL: "https://www.dhl.de/en/privatkunden/dhl-sendungsverfolgung.html?piececode=LF123456785DE",
            carrierData: CarrierData(activeTrackingCarrier: .swissPost, originalCarrier: .dhl, originalTrackingNumber: "LF123456785DE"),
            notificationsMuted: false
        )
        let links = catalog.trackingLinks(for: parcel, language: .en)
        XCTAssertEqual(parcel.trackingNumbers.count, 1)
        XCTAssertEqual(parcel.displayedCarrier, .dhl)
        XCTAssertEqual(links.map(\.carrier), [.swissPost, .dhl])
        XCTAssertEqual(links[0].url.host, "service.post.ch")
        XCTAssertEqual(links[1].url.host, "www.dhl.de")
    }

    func testHandoffUsesDifferentLocalTrackingNumber() {
        let parcel = Parcel(
            id: UUID(), trackingNumber: "123456789011", label: "Perfume",
            carrier: .glsDe, createdAt: "2026-09-10T07:00:00Z", syncStatus: .ok,
            carrierData: CarrierData(activeTrackingCarrier: .swissPost, activeTrackingNumber: "990000000000000001",
                originalCarrier: .glsDe, originalTrackingNumber: "123456789011"), notificationsMuted: false
        )
        XCTAssertEqual(parcel.trackingNumbers.map(\.number), ["990000000000000001", "123456789011"])
        XCTAssertEqual(parcel.trackingNumbers.map(\.carrier), [.swissPost, .glsDe])
        let links = catalog.trackingLinks(for: parcel, language: .en)
        XCTAssertEqual(links.map(\.carrier), [.swissPost, .glsDe])
        XCTAssertTrue(links[0].url.absoluteString.contains("990000000000000001"))
        XCTAssertFalse(links[0].url.absoluteString.contains("123456789011"))
        XCTAssertTrue(links[1].url.absoluteString.contains("123456789011"))
    }

    func testDHLEcommerceDetection() {
        XCTAssertEqual(catalog.detect("33870000000000001").confidence, .low)
        XCTAssertEqual(catalog.detect("GM1234567890123456").carrier.rawValue, "dhl-ecommerce")
        XCTAssertEqual(catalog.parse("https://www.dhl.com/ch-en/home/tracking.html?tracking-id=33870000000000001").carrier.rawValue, "dhl-ecommerce")
        XCTAssertEqual(catalog.parse("https://ecommerceportal.dhl.com/track/?tracking-id=ABC123456").carrier.rawValue, "dhl-ecommerce")
        XCTAssertEqual(catalog.parse("https://www.dhl.com/ch-en/home/tracking.html?tracking-id=LF123456785DE").carrier, .dhl)
        XCTAssertTrue(catalog.tracksAutomatically(CarrierID(rawValue: "dhl-ecommerce")))
    }

    func testExpandedCarriersAndHiddenUniversalLookup() {
        for raw in ["hermes-de", "gls-de", "delivengo"] {
            let carrier = CarrierID(rawValue: raw)
            XCTAssertTrue(catalog.tracksAutomatically(carrier))
        }
        XCTAssertTrue(catalog.tracksAutomatically(.unknown))
        XCTAssertEqual(catalog.parse("https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#H1234567890123456789").carrier.rawValue, "hermes-de")
        for (country, carrier) in [("DE", "gls-de"), ("FR", "gls-fr"), ("CH", "gls-ch")] {
            XCTAssertEqual(catalog.parse("https://gls-group.eu/\(country)/en/parcel-tracking?match=12345678901").carrier.rawValue, carrier)
        }
        XCTAssertEqual(catalog.parse("https://t.17track.net/en#nums=1Z999AA10123456784").carrier, .ups)
        XCTAssertEqual(catalog.parse("https://parcelsapp.com/fr/tracking/ZZ12345678900").carrier, .unknown)
        XCTAssertEqual(catalog.parse("https://t.17track.net/en#nums=ZZ12345678900").trackingNumber, "ZZ12345678900")
    }

    func testDetectsHighConfidenceCarriers() {
        XCTAssertEqual(catalog.detect("1Z999AA10123456784").carrier, .ups)
        XCTAssertEqual(catalog.detect("443412345678901234").carrier, .quickpac)
        XCTAssertEqual(catalog.detect("RA123456785CH").carrier, .swissPost)
        XCTAssertEqual(catalog.detect("250123456789012").carrier, .dpdFr)
        XCTAssertEqual(catalog.detect("CC200000000401").carrier, .relaisColis)
        XCTAssertEqual(catalog.detect("FGRC45BKLM").carrier, .cChezVous)
        XCTAssertEqual(catalog.detect("ASE12345678").carrier, .asendia)
        XCTAssertEqual(catalog.detect("FR1234567890").carrier, .amazonLogistics)
        XCTAssertEqual(catalog.detect("2103/11207088").carrier.rawValue, "nacex")
        XCTAssertEqual(catalog.parse("2103/11207088").carrier.rawValue, "nacex")
        XCTAssertEqual(catalog.parse("Tracking: 2103/11207088").trackingNumber, "2103/11207088")
    }

    func testKeepsAmbiguousCarrierForConfirmation() {
        let result = catalog.detect("12345678901234")
        XCTAssertEqual(result.carrier, .unknown)
        XCTAssertEqual(result.confidence, .low)
        XCTAssertTrue(result.candidates.contains(.dpd))

        for value in ["AB12CD34", "36631000001", "99112233445575012"] {
            let frenchResult = catalog.detect(value)
            XCTAssertEqual(frenchResult.carrier, .unknown)
            XCTAssertEqual(frenchResult.confidence, .low)
        }
        XCTAssertEqual(catalog.detect("99112233445500000").confidence, .low)
    }

    func testRecognitionAsksOnlyAboutASettledAmbiguousNumber() {
        let number = "12345678901"
        let ambiguous = catalog.parse(number)
        let asked = catalog.recognitionCandidates(for: number)
        XCTAssertEqual(ambiguous.confidence, .low)
        XCTAssertEqual(ambiguous.carrier, .unknown)
        // The scraper may add a network to the shape; the known ones keep their order.
        XCTAssertEqual(asked.filter { [.glsCh, .glsDe, .postlogistics].contains($0) }, [.glsCh, .glsDe, .postlogistics])
        XCTAssertTrue(CarrierRecognition.applies(to: ambiguous, amazon: false, demo: false))
        XCTAssertFalse(CarrierRecognition.applies(to: ambiguous, amazon: false, demo: true))
        XCTAssertFalse(CarrierRecognition.applies(to: ambiguous, amazon: true, demo: false))
        XCTAssertFalse(CarrierRecognition.applies(to: catalog.parse("1Z999AA10123456784"), amazon: false, demo: false))
        XCTAssertEqual(catalog.recognitionCandidates(for: "1Z999AA10123456784"), [])

        var recognition = CarrierRecognition()
        // Typing alone never asks the carriers.
        XCTAssertNil(recognition.request(for: number, applies: true))
        XCTAssertEqual(recognition.status(for: number, applies: true), .idle)

        recognition.settledNumber = number
        XCTAssertEqual(recognition.request(for: number, applies: true), number)
        // The server decides which carriers to ask; the pending state stays generic.
        XCTAssertEqual(recognition.status(for: number, applies: true), .asking([]))
        XCTAssertNil(recognition.request(for: number, applies: false))
        XCTAssertEqual(recognition.status(for: number, applies: false), .idle)
        // Editing the number drops the request until it settles again.
        XCTAssertNil(recognition.request(for: "1234567890", applies: true))
        XCTAssertEqual(recognition.status(for: "1234567890", applies: true), .idle)
        XCTAssertNil(CarrierRecognition(settledNumber: "").request(for: "", applies: true))
    }

    func testRecognitionAsksDirectCandidatesForGenericPostalNumbers() {
        let number = "RR123456785FI"
        let input = catalog.parse(number)
        XCTAssertEqual(input.carrier, .internationalPost)
        XCTAssertEqual(input.confidence, .high)
        XCTAssertEqual(catalog.recognitionCandidates(for: number), [.posti, .chronopost])
        XCTAssertEqual(catalog.recognitionCandidates(for: "XR123456785TS"), [.chronopost])
        XCTAssertFalse(catalog.recognitionCandidates(for: "RR123456789FI").contains(.posti))
        XCTAssertTrue(CarrierRecognition.applies(to: input, amazon: false, demo: false))
        XCTAssertFalse(CarrierRecognition.applies(to: input, amazon: false, demo: true))
        XCTAssertFalse(CarrierRecognition.applies(to: input, amazon: true, demo: false))

        var recognition = CarrierRecognition(settledNumber: number)
        let asked: [CarrierID] = [.posti, .chronopost]
        XCTAssertEqual(recognition.request(for: number, applies: true), number)
        XCTAssertEqual(recognition.status(for: number, applies: true), .asking([]))
        recognition.answer = CarrierDetectionResponse(trackingNumber: number, carrier: .internationalPost, asked: asked)
        XCTAssertEqual(recognition.status(for: number, applies: true), .notFound(asked))
        recognition.answer = CarrierDetectionResponse(trackingNumber: number, carrier: .posti, asked: asked)
        XCTAssertEqual(recognition.status(for: number, applies: true), .recognized(.posti))
    }

    func testRecognitionAnswersResolveAChoiceOrSayWhatHappened() throws {
        let number = "12345678901"
        let asked: [CarrierID] = [.glsCh, .glsDe]
        var recognition = CarrierRecognition(settledNumber: number)

        recognition.answer = CarrierDetectionResponse(trackingNumber: number, carrier: .glsCh, asked: asked)
        XCTAssertEqual(recognition.status(for: number, applies: true), .recognized(.glsCh))
        XCTAssertEqual(recognition.status(for: number, applies: false), .idle)
        // One answer per settled number: returning to it shows the answer without asking again.
        XCTAssertNil(recognition.request(for: number, applies: true))
        // An answer for another number never leaks into the current one.
        XCTAssertEqual(recognition.status(for: "12345678902", applies: true), .idle)
        // The recognized carrier brings its required postcode, which then gates Add.
        let postcode = try XCTUnwrap(catalog.requirements(for: .glsCh, trackingNumber: number).first)
        XCTAssertEqual(postcode.field, .dpdPostcode)
        XCTAssertFalse(postcode.isOptional)

        recognition.answer = CarrierDetectionResponse(trackingNumber: "06080000000002", carrier: .unknown, recognized: [.dpd, .hermesDe])
        XCTAssertEqual(recognition.status(for: "06080000000002", applies: true), .several([.dpd, .hermesDe]))
        XCTAssertEqual(recognition.status(for: number, applies: true), .asking([]))

        // Every carrier said no, and every carrier failing, are told apart; one failing is still a no.
        recognition.answer = CarrierDetectionResponse(trackingNumber: number, carrier: .unknown, asked: asked)
        XCTAssertEqual(recognition.status(for: number, applies: true), .notFound(asked))
        recognition.answer = CarrierDetectionResponse(trackingNumber: number, carrier: .unknown, asked: asked, unanswered: [.glsDe])
        XCTAssertEqual(recognition.status(for: number, applies: true), .notFound(asked))
        recognition.answer = CarrierDetectionResponse(trackingNumber: number, carrier: .unknown, asked: asked, unanswered: asked)
        XCTAssertEqual(recognition.status(for: number, applies: true), .failed(asked))
        // A server that asked nobody leaves the number to routing.
        recognition.answer = CarrierDetectionResponse(trackingNumber: number, carrier: .unknown, recognized: [.glsDe])
        XCTAssertEqual(recognition.status(for: number, applies: true), .unasked)
    }

    func testARecognitionRequestFailureHasNoCarrierAttemptsAndDoesNotLoop() {
        let number = "12345678901"
        var recognition = CarrierRecognition(settledNumber: number)
        XCTAssertEqual(recognition.request(for: number, applies: true), number)

        recognition.failedNumber = number

        XCTAssertNil(recognition.answer)
        XCTAssertNil(recognition.request(for: number, applies: true))
        XCTAssertEqual(recognition.status(for: number, applies: true), .failed([]))
        XCTAssertEqual(recognition.status(for: number, applies: false), .idle)
        // Settling another number still starts a new check.
        let nextNumber = "12345678902"
        recognition.settledNumber = nextNumber
        XCTAssertEqual(recognition.request(for: nextNumber, applies: true), nextNumber)
        XCTAssertEqual(recognition.status(for: nextNumber, applies: true), .asking([]))
    }

    func testRecognitionReportsOnlyTheCarriersInTheServerAnswer() {
        let number = "12345678901"
        let serverAsked: [CarrierID] = [.glsDe, .postlogistics]
        var recognition = CarrierRecognition(settledNumber: number)
        XCTAssertNotEqual(serverAsked, catalog.discoveryCandidates(for: number))

        recognition.answer = CarrierDetectionResponse(trackingNumber: number, carrier: .unknown, asked: serverAsked)
        XCTAssertEqual(recognition.status(for: number, applies: true), .notFound(serverAsked))

        recognition.answer = CarrierDetectionResponse(
            trackingNumber: number, carrier: .unknown, asked: serverAsked, unanswered: serverAsked
        )
        XCTAssertEqual(recognition.status(for: number, applies: true), .failed(serverAsked))
    }

    func testCarrierPickerSearchesNamesOtherNamesAndCountries() {
        func names(_ query: String, preferred: Set<CarrierID> = []) -> [String] {
            CarrierPickerSearch.search(query, catalog: catalog, language: .en, preferred: preferred)
                .map { catalog.info(for: $0.carrier).displayName }
        }
        XCTAssertEqual(Array(names("dpd").prefix(2)), ["DPD", "DPD France"])
        XCTAssertEqual(names("colis prive").first, "Colis Privé")
        XCTAssertEqual(Array(names("jt").prefix(2)), ["J&T Cargo", "J&T Express"])
        XCTAssertEqual(names("4px").first, "4PX")
        let hugger = CarrierPickerSearch.search("hugger", catalog: catalog, language: .en).first
        XCTAssertEqual(hugger?.carrier, .swissPostCargo)
        XCTAssertEqual(hugger?.alias, "Hugger")
        XCTAssertNil(hugger?.highlight)
        XCTAssertEqual(names("die post").first, "Swiss Post")
        XCTAssertEqual(names("hermes uk").first, "Evri UK")
        let colis = CarrierPickerSearch.search("colis", catalog: catalog, language: .en)
        XCTAssertEqual(colis.map { catalog.info(for: $0.carrier).displayName },
                       ["Colis Privé", "Colisweb", "La Poste / Colissimo", "Relais Colis"])
        XCTAssertEqual(colis[2].highlight, 11..<16)
        XCTAssertTrue(Set(names("italy")).isSuperset(of: ["BRT", "Poste Italiane", "InPost"]))
        // Countries are searched in the reader's language and in English.
        XCTAssertTrue(names("italien").isEmpty)
        XCTAssertTrue(Set(CarrierPickerSearch.search("italien", catalog: catalog, language: .de)
            .map(\.carrier)).isSuperset(of: [.brt, .posteItaliane]))
        XCTAssertEqual(names("gls").first, "GLS France")
        XCTAssertEqual(names("gls", preferred: [.glsCh]).first, "GLS Switzerland")
        XCTAssertEqual(names("zzqx"), [])
    }

    func testCarrierPickerSectionsAndLines() {
        let sections = CarrierPickerSearch.letterSections(catalog: catalog, language: .en)
        XCTAssertEqual(sections.flatMap(\.carriers).count, catalog.selectableCarriers.count)
        XCTAssertEqual(sections.first?.letter, "A")
        XCTAssertEqual(sections.last, .init(letter: "#", carriers: [.fourPx]))
        let name = { (code: String) in TrackingLocation.countryName(code, language: .en) }
        XCTAssertEqual(CarrierPickerSearch.countryLine(["CH", "LI"], name: name), "Switzerland · Liechtenstein")
        XCTAssertEqual(CarrierPickerSearch.countryLine(["FR", "BE", "ES", "LU", "PT"], name: name), "France · Belgium +3")
        XCTAssertEqual(CarrierPickerSearch.countryLine(catalog.info(for: .amazonLogistics).countries ?? [], name: name), "")
        XCTAssertEqual(CarrierPickerSearch.countryLine([], name: name), "")
        let parcels = [("dpd", "2026-09-01"), ("swiss-post", "2026-09-03"), ("unknown", "2026-09-04"),
                       ("dpd", "2026-09-02"), ("planzer", "2026-08-01"), ("ups", "2026-07-01")].map { carrier, day in
            Parcel(id: UUID(), trackingNumber: "TEST", label: "", carrier: CarrierID(rawValue: carrier),
                   createdAt: "\(day)T00:00:00Z", syncStatus: .ok, notificationsMuted: false)
        }
        XCTAssertEqual(CarrierPickerSearch.usedCarriers(parcels, catalog: catalog), [.swissPost, .dpd, .planzer])
    }

    func testRecognisesDutchPostAndExplainsGenericPostalTracking() {
        let detected = catalog.detect("LX123456785NL")
        XCTAssertEqual(detected.carrier, .springGDS)
        XCTAssertEqual(detected.confidence, .high)
        XCTAssertEqual(detected.candidates, [.springGDS])
        XCTAssertEqual(catalog.detect("lx 123.456-785 nl").carrier, .springGDS)
        XCTAssertEqual(catalog.detect("LX123456789NL").carrier, .unknown)
        XCTAssertEqual(catalog.detect("RA123456785DE").carrier, .internationalPost)
        XCTAssertTrue(catalog.tracksAutomatically(.springGDS))
        XCTAssertEqual(catalog.info(for: .springGDS).displayName, "PostNL")
        XCTAssertEqual(catalog.trackingHintKey(for: .internationalPost), "add.autoSync")
        XCTAssertEqual(catalog.trackingHintKey(for: .unknown), "add.autoSync")
        XCTAssertEqual(catalog.trackingHintKey(for: .dhl), "add.autoSync")
        for input in [
            "https://postnl.post/track?barcodes=LX123456785NL",
            "https://mailingtechnology.com/tracking/?tn=LX123456785NL",
            "https://postnl.post/details/LX123456785NL",
            "https://postnl.post/tracktrace?B=LX123456785NL",
            "Your Myprotein shipment: LX123456785NL",
        ] {
            XCTAssertEqual(catalog.parse(input).carrier, .springGDS)
            XCTAssertEqual(catalog.parse(input).trackingNumber, "LX123456785NL")
        }
    }

    func testPostNLTrackingLinkRepairsObsoleteSavedRoute() throws {
        var parcel = Parcel(
            id: UUID(), trackingNumber: "LX123456785NL", label: "Postal shipment",
            carrier: .springGDS, createdAt: "2026-09-07T13:00:00Z",
            syncStatus: .ok, notificationsMuted: false
        )
        for savedURL in [nil, "https://postnl.post/details/LX123456785NL"] as [String?] {
            parcel.trackingURL = savedURL
            let link = try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .en).first)
            XCTAssertEqual(link.name, "PostNL")
            XCTAssertEqual(link.url.absoluteString, "https://postnl.post/track?barcodes=LX123456785NL")
        }
        parcel.trackingURL = "https://mailingtechnology.com/tracking/?tn=LX123456785NL"
        XCTAssertEqual(try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .en).first).url.absoluteString,
                       parcel.trackingURL)
    }

    func testRecognisesDHLGermanPostalNumbersAndLinks() {
        for number in ["LF123456785DE", "LX123456785DE", "CY123456785DE"] {
            let result = catalog.detect(number)
            XCTAssertEqual(result.carrier, .dhl)
            XCTAssertEqual(result.confidence, .high)
            XCTAssertEqual(result.candidates, [.dhl])
        }
        XCTAssertEqual(catalog.detect("lf 123.456-785 de").carrier, .dhl)
        XCTAssertEqual(catalog.detect("LF123456789DE").carrier, .unknown)
        XCTAssertEqual(catalog.detect("LF123456785US").carrier, .internationalPost)
        XCTAssertTrue(catalog.tracksAutomatically(.dhl))
        for input in [
            "https://www.dhl.de/en/privatkunden/dhl-sendungsverfolgung.html?piececode=LF123456785DE",
            "https://nolp.dhl.de/nextt-online-public/en/search?piececode=LF123456785DE",
            "https://www.deutschepost.de/de/s/sendungsverfolgung.html?piececode=LF123456785DE",
            "Your shipment: LF123456785DE",
        ] {
            XCTAssertEqual(catalog.parse(input).carrier, .dhl)
            XCTAssertEqual(catalog.parse(input).trackingNumber, "LF123456785DE")
        }
        let numeric = catalog.parse("https://www.dhl.de/int-verfolgen/?piececode=1234567890")
        XCTAssertEqual(numeric.carrier, .dhl)
        XCTAssertEqual(numeric.source, .link)
    }

    func testAmazonLogisticsRequiresAnAccountEvenWithACarrierOverride() {
        XCTAssertEqual(catalog.parse("Your parcel: FR3000000001").carrier, .amazonLogistics)
        XCTAssertTrue(catalog.requiresAmazonAccount(.unknown, trackingNumber: "fr 3000-000001"))
        XCTAssertTrue(catalog.requiresAmazonAccount(.ups, trackingNumber: "FR3000000001"))
        XCTAssertTrue(catalog.requiresAmazonAccount(.amazonLogistics))
        XCTAssertFalse(catalog.requiresAmazonAccount(.ups, trackingNumber: "1Z999AA10123456784"))
        XCTAssertFalse(catalog.tracksAutomatically(.amazonLogistics))
        XCTAssertEqual(catalog.trackingHintKey(for: .amazonLogistics), "add.amazonAccount")
        XCTAssertEqual(catalog.info(for: .amazonLogistics).trackingURLTemplate,
                       "https://www.amazon.com/gp/your-account/order-history")
    }

    func testAmazonLogisticsReplacesSavedFallbackLinks() throws {
        var parcel = Parcel(id: UUID(), trackingNumber: "FR3000000001", label: "Example", carrier: .unknown,
            createdAt: "2026-09-10T12:00:00Z", syncStatus: .error, notificationsMuted: false)
        parcel.carrierData = CarrierData(trackingProvider: "ParcelsApp")
        parcel.trackingURL = "https://track.amazon.fr/tracking/FR3000000001"
        XCTAssertEqual(parcel.activeTrackingCarrier, .amazonLogistics)
        let link = try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .fr).first)
        XCTAssertEqual(link.name, "Amazon Logistics")
        XCTAssertEqual(link.url.absoluteString, "https://www.amazon.fr/gp/your-account/order-history")
    }

    func testDetectsInternationalAmazonAndKeepsConfirmedShippingDistinct() {
        for prefix in ["FR", "DE", "BE", "UK", "GB", "IT", "ES", "NL", "AT", "IE", "PL", "SE", "PT", "CH"] {
            let number = "\(prefix)0000000001"
            XCTAssertEqual(catalog.parse(number).carrier, .amazonLogistics)
            XCTAssertEqual(catalog.parse("Your parcel: \(number)").carrier, .amazonLogistics)
            XCTAssertTrue(catalog.requiresAmazonAccount(.unknown, trackingNumber: number))
            XCTAssertFalse(catalog.requiresAmazonAccount(.amazonShipping, trackingNumber: number))
        }
        XCTAssertEqual(catalog.parse("TBA000000000001").carrier, .amazonLogistics)
        XCTAssertFalse(catalog.isAmazonTrackingNumber("ZZ0000000001"))
        XCTAssertFalse(catalog.isAmazonTrackingNumber("TBA00000000001"))
        XCTAssertTrue(catalog.tracksAutomatically(.amazonShipping))
        XCTAssertEqual(CarrierCatalog.amazonOrdersURL("BE0000000001").host, "www.amazon.com.be")
        XCTAssertEqual(CarrierCatalog.amazonOrdersURL("UK0000000001").host, "www.amazon.co.uk")
        XCTAssertEqual(CarrierCatalog.amazonShippingURL("IT0000000001").host, "track.amazon.it")
        XCTAssertEqual(CarrierCatalog.amazonShippingURL("TBA000000000001").host, "track.amazon.com")
        XCTAssertEqual(CarrierCatalog.amazonOrdersURL("TBA000000000001").host, "www.amazon.com")
        XCTAssertEqual(CarrierCatalog.amazonOrdersURL("tbc 000000000001").host, "www.amazon.ca")
        XCTAssertEqual(CarrierCatalog.amazonOrdersURL("TBM000000000001").host, "www.amazon.com.mx")
        XCTAssertEqual(CarrierCatalog.amazonShippingURL("TBC000000000001").host, "track.amazon.com")
        let parcel = Parcel(id: UUID(), trackingNumber: "UK0000000001", label: "Example", carrier: .amazonShipping,
            createdAt: "2026-09-10T12:00:00Z", syncStatus: .ok, notificationsMuted: false)
        XCTAssertEqual(parcel.activeTrackingCarrier, .amazonShipping)
        XCTAssertEqual(catalog.trackingLinks(for: parcel, language: .en).first?.url.host, "track.amazon.co.uk")
    }

    func testParsesKnownCarrierLink() {
        let parsed = catalog.parse("Track it: https://www.ups.com/track?tracknum=1Z999AA10123456784")
        XCTAssertEqual(parsed.trackingNumber, "1Z999AA10123456784")
        XCTAssertEqual(parsed.carrier, .ups)
        XCTAssertEqual(parsed.source, .link)
    }

    func testTakesALettersOnlyNumberOnlyWhenACarrierClaimsItsShape() {
        // Letters alone are a number in a shape a carrier's rule claims, as six are for a GLS Track ID.
        for input in ["ABCDEF", " abcdef "] {
            XCTAssertEqual(catalog.parse(input).source, .number, input)
        }
        // A word no carrier uses stays a word, whatever a general rule makes of its length.
        for input in ["ABCDE", "BONJOUR", "TRACKING", "CONFIRMATION", "ABC DEF", "ABC-DEF", "AB.CD.EF"] {
            XCTAssertEqual(catalog.parse(input).source, TrackingInputMatch.Source.none, input)
        }
        // A word that follows a label in a message stays a word.
        XCTAssertEqual(catalog.parse("Tracking number: pending").source, TrackingInputMatch.Source.none)
        XCTAssertEqual(catalog.parse("Your shipment arrives Monday").source, TrackingInputMatch.Source.none)
    }

    func testReadsTheNumberALabelIntroduces() {
        for text in [
            "Tracking number: 12345678901",
            "Tracking number 12345678901",
            "Your tracking number is 12345678901.",
            "tracking no. 12345678901",
            "Tracking ID: 12345678901",
            "Tracking: 12345678901",
            "track 12345678901",
            "Parcel number: 12345678901",
            "Shipment tracking number: 12345678901",
            "Tracking update. Your parcel number 12345678901 leaves today",
        ] {
            let parsed = catalog.parse(text)
            XCTAssertEqual(parsed.trackingNumber, "12345678901", text)
            XCTAssertEqual(parsed.source, .text, text)
        }
        // A label word attached to the number stays with it, and no word is taken for a number.
        XCTAssertEqual(catalog.parse("Tracking NO123456789").trackingNumber, "NO123456789")
        XCTAssertEqual(catalog.parse("tracking notable1234").trackingNumber, "notable1234")
        XCTAssertEqual(catalog.parse("Shipment tracking: delayed").source, TrackingInputMatch.Source.none)
    }

    func testParsesGeodisHashLinkAndExposesFrenchCarriersInThePicker() {
        let parsed = catalog.parse(
            "https://espace-client.geodis.com/services/destinataires/#/fr/suivi/1G123GEODIS0"
        )
        XCTAssertEqual(parsed.trackingNumber, "1G123GEODIS0")
        XCTAssertEqual(parsed.carrier, .geodis)
        XCTAssertEqual(parsed.source, .link)
        for carrier in [
            CarrierID.dpdFr, .mondialRelay, .relaisColis,
            .laPoste, .chronopost, .glsFr, .colisPrive, .geodis,
            .swissPostCargo, .glsCh, .colisweb, .cChezVous,
            .heppner, .ciblex, .paack,
        ] {
            XCTAssertTrue(catalog.selectableCarriers.contains(carrier), carrier.rawValue)
            XCTAssertTrue(catalog.tracksAutomatically(carrier), carrier.rawValue)
        }
        XCTAssertTrue(catalog.selectableCarriers.contains(.asendia))
        for carrier in [CarrierID.asendia, .fedex, .shipup] {
            XCTAssertTrue(catalog.tracksAutomatically(carrier), carrier.rawValue)
        }
    }

    func testCountrySpecificPostcodeRequirementsNormalizeAndValidate() throws {
        let glsGermany = try XCTUnwrap(
            catalog.requirements(for: .glsDe, trackingNumber: "123456789018")
                .first(where: { $0.field == .dpdPostcode })
        )
        XCTAssertTrue(glsGermany.accepts("8000"))
        XCTAssertTrue(glsGermany.accepts("01067"))
        XCTAssertFalse(glsGermany.accepts("800"))
        XCTAssertFalse(glsGermany.accepts("123456"))
        XCTAssertFalse(glsGermany.isOptional)
        XCTAssertFalse(glsGermany.isSatisfied(by: ""))
        XCTAssertEqual(catalog.info(for: .unknown, language: .en).displayName, "Unknown carrier")
        XCTAssertEqual(catalog.info(for: .unknown, language: .fr).displayName, "Transporteur inconnu")
        let dpd = try XCTUnwrap(
            catalog.requirements(for: .dpd, trackingNumber: "12345678901234")
                .first(where: { $0.field == .dpdPostcode })
        )
        // DPD delivers abroad too: any country's postcode, as that country writes it.
        XCTAssertNil(dpd.placeholder)
        XCTAssertEqual(dpd.maxLength, 12)
        XCTAssertEqual(dpd.normalizedValue(" sw1a  1aa "), "SW1A 1AA")
        XCTAssertEqual(dpd.typedValue("sw1a "), "SW1A ")
        XCTAssertEqual(dpd.typedValue("sw1a  "), "SW1A ")
        XCTAssertEqual(dpd.typedValue(" "), "")
        XCTAssertEqual(dpd.typedValue("123456789012 "), "123456789012")
        for postcode in ["8000", "75001", "SW1A 1AA", "1012 AB", "00-001", "sw1a 1aa "] {
            XCTAssertTrue(dpd.accepts(postcode), postcode)
        }
        for postcode in ["12", "ABCDE", "75001/2", "75 - 001", "1234567890123"] {
            XCTAssertFalse(dpd.accepts(postcode), postcode)
        }
        // DPD tracks without the postcode; one that is typed must still be valid.
        XCTAssertTrue(dpd.isOptional)
        XCTAssertTrue(dpd.isSatisfied(by: ""))
        XCTAssertTrue(dpd.isSatisfied(by: "  "))
        XCTAssertTrue(dpd.isSatisfied(by: "8000"))
        XCTAssertFalse(dpd.isSatisfied(by: "80"))

        // The example is the device's country, then the carrier's own.
        XCTAssertEqual(catalog.postcodeExample(for: .dpd, requirement: dpd, region: "FR"), "75001")
        XCTAssertEqual(catalog.postcodeExample(for: .dpd, requirement: dpd, region: "gb"), "SW1A 1AA")
        XCTAssertEqual(catalog.postcodeExample(for: .dpd, requirement: dpd, region: "BR"), "8000")
        XCTAssertEqual(catalog.postcodeExample(for: .dpd, requirement: dpd, region: nil), "8000")
        XCTAssertTrue(dpd.startsWithNumberKeys(example: "75001"))
        XCTAssertFalse(dpd.startsWithNumberKeys(example: "SW1A 1AA"))
        for example in CarrierCatalog.postcodeExamples.values {
            XCTAssertTrue(dpd.accepts(example), example)
        }

        // A national network keeps its own shape and example wherever the device is.
        let dpdGermany = try XCTUnwrap(
            catalog.requirements(for: .dpdDe, trackingNumber: "12345678901234")
                .first(where: { $0.field == .dpdPostcode })
        )
        XCTAssertEqual(catalog.postcodeExample(for: .dpdDe, requirement: dpdGermany, region: "FR"), "10115")
        XCTAssertEqual(dpdGermany.typedValue("10 115 "), "10115")
        XCTAssertFalse(dpdGermany.accepts("8000"))
        XCTAssertFalse(dpdGermany.startsWithNumberKeys(example: "10115"))

        let mondialRelay = try XCTUnwrap(
            catalog.requirements(for: .mondialRelay, trackingNumber: "76434219")
                .first(where: { $0.field == .dpdPostcode })
        )
        XCTAssertEqual(mondialRelay.placeholder, "75001")
        XCTAssertEqual(mondialRelay.maxLength, 5)
        XCTAssertEqual(mondialRelay.normalizedValue("75 A001 9"), "75001")
        XCTAssertTrue(mondialRelay.accepts("75001"))
        XCTAssertFalse(mondialRelay.accepts("8000"))
        XCTAssertFalse(mondialRelay.isOptional)
        XCTAssertFalse(mondialRelay.isSatisfied(by: ""))

        let gls = try XCTUnwrap(
            catalog.requirements(for: .glsCh, trackingNumber: "993990103198")
                .first(where: { $0.field == .dpdPostcode })
        )
        XCTAssertTrue(gls.accepts("8000"))
        XCTAssertFalse(gls.accepts("75001"))
        XCTAssertFalse(gls.isOptional)
        XCTAssertFalse(gls.isSatisfied(by: ""))

        let heppner = try XCTUnwrap(
            catalog.requirements(for: .heppner, trackingNumber: "23456789")
                .first(where: { $0.field == .dpdPostcode })
        )
        XCTAssertTrue(heppner.accepts("1201"))
        XCTAssertTrue(heppner.accepts("75001"))
        XCTAssertFalse(heppner.isOptional)
        XCTAssertFalse(heppner.isSatisfied(by: ""))

        let paack = try XCTUnwrap(
            catalog.requirements(for: .paack, trackingNumber: "PAACK12345")
                .first(where: { $0.field == .dpdPostcode })
        )
        XCTAssertTrue(paack.accepts("1234-567"))
        XCTAssertFalse(paack.accepts("12--345"))
        XCTAssertFalse(paack.accepts("ABC"))
        XCTAssertEqual(paack.normalizedValue("sw1a 1aa"), "SW1A1AA")
        XCTAssertFalse(paack.isOptional)
        XCTAssertFalse(paack.isSatisfied(by: ""))
    }

    func testBuildsUsableCarrierLinks() throws {
        var parcel = Parcel(
            id: UUID(),
            trackingNumber: "4TZKO15679059600",
            label: "Furniture",
            carrier: .cChezVous,
            createdAt: "2026-08-30T13:00:00Z",
            syncStatus: .ok,
            notificationsMuted: false
        )
        XCTAssertEqual(
            try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .fr).first).url.absoluteString,
            "https://www.cchezvous.fr/suivi-colis/4TZKO156790--59600"
        )

        parcel.trackingNumber = "PAACK12345"
        parcel.carrier = .paack
        parcel.dpdPostcode = "75001"
        XCTAssertEqual(
            try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .fr).first).url.absoluteString,
            "https://mydeliveries.paack.app/tracking?tracking_number=PAACK12345"
        )
    }

    func testExternalTrackingSitesUseSupportedLanguages() throws {
        var parcel = Parcel(
            id: UUID(), trackingNumber: "993412345612345678", label: "Parcel",
            carrier: .swissPost, createdAt: "2026-09-07T13:00:00Z",
            syncStatus: .unsupported, notificationsMuted: false
        )
        for language in [AppLanguage.es, .pt, .pl] {
            let url = try XCTUnwrap(catalog.trackingLinks(for: parcel, language: language).first).url
            XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "lang" }?.value, "en")
        }
        parcel.carrier = .unknown
        parcel.trackingNumber = "ZZ12345678900"
        parcel.trackingURL = "https://parcelsapp.com/fr/tracking/ZZ12345678900"
        for (language, name) in [(AppLanguage.es, "Transportista desconocido"), (.pt, "Transportadora desconhecida"), (.pl, "Nieznany przewoźnik")] {
            XCTAssertEqual(catalog.info(for: .unknown, language: language).displayName, name)
            let url = try XCTUnwrap(catalog.trackingLinks(for: parcel, language: language).first).url
            XCTAssertEqual(url.absoluteString, "https://parcelsapp.com/\(language == .pl ? "en" : language.rawValue)/tracking/ZZ12345678900")
        }
    }

    func testUnknownPostalCarrierUsesLocalized17TrackInsteadOfLegacySwissPostLink() throws {
        var parcel = Parcel(
            id: UUID(), trackingNumber: "RA123456785DE", label: "Postal shipment",
            carrier: .internationalPost, createdAt: "2026-09-07T13:00:00Z",
            syncStatus: .unsupported, notificationsMuted: false
        )
        let names: [AppLanguage: String] = [
            .en: "Unknown postal carrier", .de: "Postanbieter unbekannt",
            .fr: "Transporteur postal inconnu", .it: "Corriere postale sconosciuto",
            .es: "Operador postal desconocido", .pt: "Operador postal desconhecido",
            .pl: "Nieznany operator pocztowy",
        ]
        for language in AppLanguage.allCases {
            for savedURL in [nil, "https://service.post.ch/ekp-web/ui/entry/search/RA123456785DE"] as [String?] {
                parcel.trackingURL = savedURL
                let link = try XCTUnwrap(catalog.trackingLinks(for: parcel, language: language).first)
                XCTAssertEqual(catalog.info(for: .internationalPost, language: language).displayName, names[language])
                XCTAssertEqual(link.name, "17TRACK")
                XCTAssertEqual(link.url.absoluteString, "https://t.17track.net/\(language.rawValue)#nums=RA123456785DE")
                XCTAssertEqual(link.carrier, .internationalPost)
            }
        }
        XCTAssertEqual(catalog.info(for: .internationalPost).displayName, "Unknown postal carrier")
        XCTAssertTrue(catalog.tracksAutomatically(.internationalPost))

        parcel.carrier = .swissPost
        parcel.trackingNumber = "RA123456785CH"
        parcel.trackingURL = nil
        let swissPost = try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .fr).first)
        XCTAssertEqual(swissPost.name, "Swiss Post")
        XCTAssertEqual(swissPost.url.absoluteString, "https://service.post.ch/ekp-web/ui/entry/search/RA123456785CH?lang=fr")

        parcel.carrier = .dhl
        parcel.trackingNumber = "LF123456785DE"
        parcel.trackingURL = "https://www.dhl.de/int-verfolgen/?piececode=LF123456785DE"
        let dhl = try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .fr).first)
        XCTAssertEqual(dhl.name, "DHL")
        XCTAssertEqual(dhl.url.absoluteString, parcel.trackingURL)
    }

    func testPlanzerLinkKeepsQuickpacIdentityFor44Barcode() {
        let parsed = catalog.parse(
            "https://tracking.app.planzer.ch/delivery/info?deliveryNumber=443412345678901234"
        )
        XCTAssertEqual(parsed.carrier, .quickpac)
        XCTAssertEqual(parsed.source, .link)
    }

    func testFormattingAndS10Checksum() {
        XCTAssertEqual(CarrierCatalog.format("993412345678901234"), "99.34.123456.78901234")
        XCTAssertTrue(CarrierCatalog.isValidS10("RA123456785CH"))
        XCTAssertFalse(CarrierCatalog.isValidS10("RA123456789CH"))
    }

    func testNumericChecksumSchemes() {
        for number in ["1234567891", "0000000070"] {
            XCTAssertTrue(CarrierCatalog.isValidDhlExpressWaybill(number))
        }
        for number in ["1234567890", "1234567897", "123456789", "12345678910", "1234567891\n", "123 4567891"] {
            XCTAssertFalse(CarrierCatalog.isValidDhlExpressWaybill(number))
        }
        for number in ["123456782", "123456785", "000000005", "000000080"] {
            XCTAssertTrue(CarrierCatalog.isValidTntConsignmentNumber(number))
        }
        for number in ["123456789", "12345678", "1234567850", "123456785\n", "1234-56785"] {
            XCTAssertFalse(CarrierCatalog.isValidTntConsignmentNumber(number))
        }
        for number in ["12345678901234567890", "00000000000000000017"] {
            XCTAssertTrue(CarrierCatalog.isValidPocztaPolskaBarcode(number))
        }
        for number in ["12345678901234567891", "1234567890123456789", "123456789012345678900", "12345678901234567890\n"] {
            XCTAssertFalse(CarrierCatalog.isValidPocztaPolskaBarcode(number))
        }
        for number in ["PL00ZZ000000001Z", "PL00ZZ0000000010100000Y"] {
            XCTAssertTrue(CarrierCatalog.isValidCorreosSpainCheckLetter(number))
        }
        for number in ["PL00ZZ000000001A", "PL00ZZ0000000010100000Z", "PL00ZZ000000002Z", "Z", ""] {
            XCTAssertFalse(CarrierCatalog.isValidCorreosSpainCheckLetter(number))
        }
        for number in ["12345678901234E", "00000000000000U", "99999999999999Z", "012345678901233"] {
            XCTAssertTrue(CarrierCatalog.isValidDpdParcelNumber(number))
        }
        for number in ["12345678901234F", "123456789012343", "12345678901234", "1234567890123E", "12345678901234EE", "12345678901234e", "12345678901234E\n"] {
            XCTAssertFalse(CarrierCatalog.isValidDpdParcelNumber(number))
        }
        let express = catalog.detect("123 456-7891")
        XCTAssertEqual(express.carrier, .unknown)
        XCTAssertEqual(express.confidence, .low)
        XCTAssertEqual(express.preferred, [.dhlExpress])
        XCTAssertEqual(catalog.recognitionCandidates(for: "1234567891").first, .dhlExpress)
        XCTAssertFalse(catalog.detect("1234567890").candidates.contains(.dhlExpress))
        XCTAssertEqual(catalog.detect("123456785").preferred, [.tnt])
        XCTAssertFalse(catalog.detect("123456789").candidates.contains(.tnt))
        XCTAssertTrue(catalog.detect("1234567890123456").candidates.contains(.tnt))
        XCTAssertEqual(catalog.detect("00159007731234567899").preferred, [.pocztaPolska])
        XCTAssertFalse(catalog.detect("12345678901234567891").candidates.contains(.pocztaPolska))
        XCTAssertTrue(catalog.detect("1234567890123456789").candidates.contains(.pocztaPolska))
    }

    func testUspsPackageChecksumsIgnoreRoutingAndRejectAmbiguousSplits() {
        // Synthetic PICs, with independently calculated MOD10 check digits.
        let pic = "9210090000000012345679"
        let longPic = "92000000000123456789012344"
        let routed = ["42000000" + pic, "420000000000" + pic, "42000000" + longPic]
        for number in [pic, longPic, "9300000000000000000000", "9400000000000000000009"] + routed {
            XCTAssertTrue(CarrierCatalog.isValidUspsPackageBarcode(number), number)
            let match = catalog.detect(number)
            XCTAssertEqual(match.carrier, .unknown, number)
            XCTAssertEqual(match.confidence, .low, number)
            XCTAssertEqual(match.preferred, [.usps], number)
        }
        XCTAssertTrue(CarrierCatalog.isValidUspsPackageBarcode("9210 0900-0000.0012 3456 79"))
        // Retail labels use channel 95; 91 is the legacy construct.
        for number in ["9500000000000000000008", "9100000000000000000002", "420123459102" + pic] {
            XCTAssertTrue(CarrierCatalog.isValidUspsPackageBarcode(number), number)
        }
        for number in [
            String(pic.dropLast()) + "1", "42000000" + String(pic.dropLast()) + "1",
            "420ABCDE" + pic, "4200000" + pic, "420000000" + pic,
            "420000000000" + longPic, "420000009201" + pic,
            "9600000000000000000007", String(pic.dropLast()), pic + "0",
        ] {
            XCTAssertFalse(CarrierCatalog.isValidUspsPackageBarcode(number), number)
            XCTAssertFalse(catalog.detect(number).preferred.contains(.usps), number)
            if number.hasPrefix("420") {
                XCTAssertFalse(catalog.detect(number).candidates.contains(.usps), number)
            }
        }
        for number in routed {
            XCTAssertEqual(catalog.recognitionCandidates(for: number), [])
            XCTAssertTrue(catalog.recognitionCandidates(for: number, browser: true).contains(.usps))
        }
    }

    func testPostlogisticsPrintedReferenceAndTrackingLink() throws {
        let printed = "12345678-001"
        let compact = "12345678001"
        XCTAssertEqual(catalog.parse(printed).carrier, .postlogistics)
        XCTAssertEqual(catalog.detect(compact).carrier, .unknown)
        XCTAssertEqual(catalog.parse("https://tracking.postlogistics.ch/public/trackandtrace/\(printed)").carrier,
            .postlogistics)
        XCTAssertEqual(CarrierCatalog.format(compact, carrier: .postlogistics), printed)
        let parcel = Parcel(id: UUID(), trackingNumber: compact, label: "Example", carrier: .postlogistics,
            createdAt: "2026-09-10T12:00:00Z", syncStatus: .ok, notificationsMuted: false)
        XCTAssertEqual(try XCTUnwrap(catalog.trackingLinks(for: parcel, language: .en).first).url.absoluteString,
            "https://tracking.postlogistics.ch/public/trackandtrace/\(printed)")
    }

    func testHermesCheckDigitAndDepotPreferenceMatchTheWebEngine() {
        XCTAssertTrue(CarrierCatalog.isValidHermesParcelNumber("12345678901231"))
        XCTAssertFalse(CarrierCatalog.isValidHermesParcelNumber("12345678901234"))
        XCTAssertTrue(catalog.detect("12345678901231").candidates.contains(.hermesDe))
        XCTAssertFalse(catalog.detect("12345678901234").candidates.contains(.hermesDe))
        XCTAssertFalse(catalog.detect("12345678901234").candidates.contains(.glsCh))

        XCTAssertTrue(CarrierCatalog.isValidGlsParcelNumber("123456789011"))
        XCTAssertFalse(CarrierCatalog.isValidGlsParcelNumber("123456789012"))
        XCTAssertTrue(catalog.detect("123456789011").candidates.contains(.glsDe))
        XCTAssertFalse(catalog.detect("123456789012").candidates.contains(.glsDe))
        XCTAssertTrue(catalog.detect("12345678901").candidates.contains(.glsDe))

        // A DPD Switzerland depot prefix lists DPD first but still asks the user.
        let swissDepot = catalog.detect("06080000000002")
        XCTAssertEqual(swissDepot.carrier, .unknown)
        XCTAssertEqual(swissDepot.confidence, .low)
        XCTAssertEqual(swissDepot.preferred, [.dpd])
        XCTAssertEqual(swissDepot.candidates.first, .dpd)
        XCTAssertEqual(catalog.detect("10000000000001").candidates.first, .dpdFr)
        XCTAssertEqual(catalog.detect("06200000000002").preferred, [])
    }

    func testAcceptsASelectableCarrierThatWasNotCompiledIntoTheApp() throws {
        let dynamic = try CarrierCatalog(data: Self.futureCatalogData)
        let futureCarrier = CarrierID(rawValue: "future-express")

        XCTAssertFalse(CarrierID.allCases.contains(futureCarrier))
        XCTAssertTrue(dynamic.selectableCarriers.contains(futureCarrier))
        XCTAssertEqual(dynamic.info(for: futureCarrier).displayName, "Future Express")
        XCTAssertEqual(dynamic.detect("FX12345678").carrier, futureCarrier)
        XCTAssertEqual(
            dynamic.parse("https://tracking.future.example/FX12345678").carrier,
            futureCarrier
        )
    }

    @MainActor
    func testRefreshesCachesAndConditionallyRevalidatesTheRemoteCatalog() async throws {
        let cacheURL = FileManager.default.temporaryDirectory
            .appending(path: "carrier-catalog-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: cacheURL) }

        let firstRecorder = CatalogRequestRecorder()
        let first = try CarrierCatalog(
            data: Self.bundledCatalogData,
            cacheURL: cacheURL,
            loader: { request in
                await firstRecorder.record(request)
                return (
                    Self.futureCatalogData,
                    Self.response(for: request, status: 200, headers: ["ETag": "\"future-v1\""])
                )
            }
        )

        let firstResult = await first.refresh(
            from: URL(string: "https://delivery.example")!,
            force: true
        )
        XCTAssertEqual(firstResult, .updated)
        let futureCarrier = CarrierID(rawValue: "future-express")
        XCTAssertEqual(first.info(for: futureCarrier).displayName, "Future Express")
        XCTAssertTrue(FileManager.default.fileExists(atPath: cacheURL.path))
        let firstRequest = await firstRecorder.lastRequest
        XCTAssertEqual(firstRequest?.url?.absoluteString, "https://delivery.example/api/carriers")
        XCTAssertNil(firstRequest?.value(forHTTPHeaderField: "If-None-Match"))

        let revalidationRecorder = CatalogRequestRecorder()
        let cached = CarrierCatalog(
            bundle: .main,
            cacheURL: cacheURL,
            loader: { request in
                await revalidationRecorder.record(request)
                return (Data(), Self.response(for: request, status: 304))
            }
        )
        XCTAssertEqual(cached.info(for: futureCarrier).displayName, "Future Express")
        // The cache is re-encoded from the decoded structs, so it must keep `optional`.
        XCTAssertEqual(
            cached.requirements(for: futureCarrier, trackingNumber: "FX12345678").map(\.isOptional),
            [true]
        )
        let cachedResult = await cached.refresh(
            from: URL(string: "https://delivery.example")!,
            force: true
        )
        XCTAssertEqual(cachedResult, .notModified)
        let revalidationRequest = await revalidationRecorder.lastRequest
        XCTAssertEqual(
            revalidationRequest?.value(forHTTPHeaderField: "If-None-Match"),
            "\"future-v1\""
        )
    }

    @MainActor
    func testRefreshedDefinitionsReplaceRememberedDetections() async throws {
        let catalog = try CarrierCatalog(
            data: Self.bundledCatalogData,
            loader: { request in (Self.futureCatalogData, Self.response(for: request, status: 200)) }
        )
        let futureCarrier = CarrierID(rawValue: "future-express")
        let link = "https://tracking.future.example/FX12345678"
        XCTAssertNotEqual(catalog.detect("FX12345678").carrier, futureCarrier)
        XCTAssertNotEqual(catalog.parse(link).carrier, futureCarrier)

        let result = await catalog.refresh(from: URL(string: "https://delivery.example")!, force: true)
        XCTAssertEqual(result, .updated)
        XCTAssertEqual(catalog.detect("FX12345678").carrier, futureCarrier)
        XCTAssertEqual(catalog.parse(link).carrier, futureCarrier)
    }

    @MainActor
    func testRejectsAnInvalidRemoteCatalogAndKeepsTheBundledDefinitions() async throws {
        let original = try CarrierCatalog(
            data: Self.bundledCatalogData,
            loader: { request in
                let invalid = Data("{\"x-carriers\":{}}".utf8)
                return (invalid, Self.response(for: request, status: 200))
            }
        )

        let result = await original.refresh(
            from: URL(string: "https://delivery.example")!,
            force: true
        )
        XCTAssertEqual(result, .failed)
        XCTAssertEqual(original.info(for: .amazonLogistics).displayName, "Amazon Logistics")
    }

    private static var bundledCatalogData: Data {
        get throws {
            let url = try XCTUnwrap(
                Bundle.main.url(forResource: "CarrierCatalog", withExtension: "json")
            )
            return try Data(contentsOf: url)
        }
    }

    private static let futureCatalogData = Data("""
    {
      "version": "test-v1",
      "x-carriers": {
        "future-express": {
          "displayName": "Future Express",
          "color": "#123456",
          "selectable": true,
          "timezone": "Europe/Paris",
          "tracking": {
            "mode": "automatic",
            "adapter": "future-express",
            "requirements": [{
              "field": "dpdPostcode",
              "validator": "swissPostcode",
              "optional": true,
              "label": "Delivery postcode",
              "type": "text",
              "pattern": "^[0-9]{4}$",
              "maxLength": 4,
              "inputMode": "numeric"
            }]
          },
          "trackingUrlTemplate": "https://tracking.future.example/{trackingNumber}",
          "linkRules": [{
            "domains": ["tracking.future.example"],
            "path": "^/([^/?#]+)$"
          }],
          "detectionRules": [{
            "pattern": "^FX\\\\d{8}$",
            "confidence": "high"
          }]
        },
        "unknown": {
          "displayName": "Carrier",
          "color": "#8e8e93",
          "selectable": false,
          "timezone": "UTC",
          "tracking": { "mode": "link-only", "adapter": null },
          "linkRules": [],
          "detectionRules": []
        }
      }
    }
    """.utf8)

    private static func response(
        for request: URLRequest,
        status: Int,
        headers: [String: String]? = nil
    ) -> HTTPURLResponse {
        HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        )!
    }
}

private actor CatalogRequestRecorder {
    private var requests: [URLRequest] = []

    func record(_ request: URLRequest) {
        requests.append(request)
    }

    var lastRequest: URLRequest? { requests.last }
}

extension CarrierCatalogTests {
    /// The scraper's published detection corpus records what the
    /// TypeScript engine answers for every sample number; the Swift port must agree.
    func testDetectionMatchesTheSharedGoldenFile() throws {
        struct Entry: Decodable {
            let input: String
            let carrier: String
            let confidence: String
            let candidates: [String]
            let preferred: [String]?
            let asked: [String]?
        }
        let url = try XCTUnwrap(Bundle.main.url(forResource: "DetectionGolden", withExtension: "json"))
        let entries = try JSONDecoder().decode([Entry].self, from: Data(contentsOf: url))
        XCTAssertGreaterThan(entries.count, 100)
        var mismatches: [String] = []
        for entry in entries {
            let match = catalog.detect(entry.input)
            let confidence: String
            switch match.confidence {
            case .high: confidence = "high"
            case .low: confidence = "low"
            case .none: confidence = "none"
            }
            let candidates = match.candidates.map(\.rawValue).sorted()
            let preferred = match.preferred.map(\.rawValue).sorted()
            if match.carrier.rawValue != entry.carrier || confidence != entry.confidence
                || candidates != entry.candidates.sorted() || preferred != (entry.preferred ?? []).sorted()
                || Array(match.candidates.prefix(preferred.count).map(\.rawValue)).sorted() != preferred {
                mismatches.append("\(entry.input): expected \(entry.carrier)/\(entry.confidence) \(entry.candidates), got \(match.carrier.rawValue)/\(confidence) \(candidates)")
            }
            // The catalog's static candidate order follows the shared engine.
            let asked = catalog.recognitionCandidates(for: entry.input).map(\.rawValue)
            if asked != (entry.asked ?? []) {
                mismatches.append("\(entry.input): expected to ask \(entry.asked ?? []), got \(asked)")
            }
        }
        XCTAssertEqual(mismatches, [], mismatches.prefix(10).joined(separator: "\n"))
    }
}
