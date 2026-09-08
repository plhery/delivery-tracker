import SwiftUI
import UIKit

struct FriendsView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var parcels: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var model = FriendsStore()
    @State private var showingAccount = false
    @State private var visible = false
    @State private var panel: FriendsPanel?
    @State private var joined = false
    private var active: Bool { visible && scenePhase == .active }
    private func text(_ key: String) -> String { localizer.text(key) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let error = model.errorKey, panel == nil { errorView(error) }
                    if joined { Label(text("friends.accepted"), systemImage: "checkmark.circle").foregroundStyle(ExperimentalPalette.delivered).font(.subheadline) }
                    if let data = model.snapshot {
                        if data.profile != nil { circle(data) }
                        else {
                            VStack(spacing: 16) {
                                FriendsPostagePair()
                                Text(text("friends.onlyFriends").uppercased()).font(.caption2.monospaced()).tracking(1.4)
                                Text(text("friends.joinTitle")).font(.system(.largeTitle, design: .rounded, weight: .bold)).tracking(-1)
                                Text(text("friends.joinIntro")).font(.subheadline).foregroundStyle(.secondary)
                            }
                            .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.vertical, 16)
                            FriendsProfileForm(profile: nil, busy: model.working) { profile in
                                Task { _ = await model.act(FriendsActionRequest(action: .saveProfile, nickname: profile.nickname, shareStats: profile.shareStats, shareArrival: profile.shareArrival), parcels: parcels.parcels) }
                            }
                        }
                    } else if model.errorKey != nil {
                        Button(text("common.retry")) { Task { await model.load(parcels: parcels.parcels) } }.buttonStyle(.bordered)
                    } else { ProgressView().frame(maxWidth: .infinity, minHeight: 260) }
                }
                .padding(20).padding(.bottom, 20).frame(maxWidth: 680).frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden).background(Brand.background)
            .safeAreaInset(edge: .top, spacing: 0) { DemoModeBar() }
            .navigationTitle(text("friends.title")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountToolbarButton { showingAccount = true } } }
            .refreshable { await model.load(parcels: parcels.parcels) }
        }
        .onAppear { visible = true; model.configure(session: session) }
        .onDisappear { visible = false; panel = nil; model.clear() }
        .task(id: active) {
            guard active else { panel = nil; model.clear(); return }
            while !Task.isCancelled {
                await model.load(parcels: parcels.parcels)
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
            }
        }
        .onChange(of: model.snapshot) { _, data in
            if case .friend(let friend) = panel, data?.friends.contains(where: { $0.id == friend.id }) != true { panel = nil }
        }
        .sheet(isPresented: $showingAccount) { AccountView() }
        .sheet(item: $panel) { value in
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if let error = model.errorKey { errorView(error) }
                        sheetContent(value)
                    }.padding(24)
                }
                .background(Brand.background)
                .navigationTitle(value.title(localizer)).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(text("common.close")) { panel = nil; model.errorKey = nil }.disabled(model.working) } }
            }
            .presentationDragIndicator(.visible).interactiveDismissDisabled(model.working)
        }
        .sensoryFeedback(.success, trigger: joined)
    }

    @ViewBuilder private func circle(_ data: FriendsSnapshot) -> some View {
        let people = [data.ownCard].compactMap { $0 } + data.friends
        let total = people.reduce(0) { $0 + ($1.stats?.stamps.count ?? 0) }
        VStack(alignment: .leading, spacing: 22) {
            HStack { Text(text("friends.collection").uppercased()).font(.caption2.monospaced()).tracking(1.6); Spacer(); Image(systemName: "person.2") }
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text(total.formatted()).font(.system(size: 64, weight: .bold, design: .rounded)).tracking(-3).contentTransition(.numericText())
                    Text(text("friends.collectionNote")).font(.subheadline)
                }
                Spacer(minLength: 10)
                FriendsPostagePair().scaleEffect(0.82).frame(width: 110, height: 90)
            }
            Divider().overlay(Brand.onAccent.opacity(0.1))
            HStack {
                HStack(spacing: -7) { ForEach(Array(people.prefix(5))) { friend in
                    Text(String(friend.nickname.prefix(1))).font(.caption.weight(.bold)).frame(width: 30, height: 30).background(Brand.paper, in: Circle()).overlay(Circle().stroke(Brand.accent, lineWidth: 2))
                } }.accessibilityHidden(true)
                Spacer()
                Text(text("friends.onlyFriends")).font(.caption2)
            }
        }
        .padding(24).foregroundStyle(Brand.onAccent).background(Brand.accent, in: RoundedRectangle(cornerRadius: 28))
        HStack(spacing: 12) {
            Button { panel = .invite } label: { Label(text("friends.invite"), systemImage: "plus").frame(maxWidth: .infinity, minHeight: 48) }
                .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
            Button { panel = .profile } label: { Image(systemName: "slider.horizontal.3").frame(width: 48, height: 48).background(Brand.paper, in: RoundedRectangle(cornerRadius: 16)) }
                .buttonStyle(TactileButtonStyle()).foregroundStyle(Brand.ink).accessibilityLabel(text("friends.settings"))
        }
        Button(text("friends.enterCode")) { panel = .accept }.font(.subheadline).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 32)
        HStack { Text(text("friends.circle")).font(.title2.bold()); Spacer(); Text(session.isDemo ? text("friends.demoPeople") : data.friends.count.formatted()).font(.caption).foregroundStyle(.secondary) }
        if data.friends.isEmpty {
            VStack(spacing: 14) { FriendsPostage(symbol: "person.2"); Text(text("friends.emptyTitle")).font(.title3.bold()); Text(text("friends.emptyDescription")).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center) }
                .padding(26).frame(maxWidth: .infinity).background(Brand.paper, in: RoundedRectangle(cornerRadius: 24))
        } else {
            ForEach(data.friends) { friend in
                Button { panel = .friend(friend) } label: { FriendCardView(friend: friend, showsArrow: true) }
                    .buttonStyle(TactileButtonStyle(scale: 0.98))
            }
        }
        Button { panel = .profile } label: {
            HStack { Label(text("friends.preview"), systemImage: "lock"); Spacer(); Text(data.profile?.nickname ?? ""); Image(systemName: "chevron.right") }
                .font(.caption).padding(18).background(Brand.paper, in: RoundedRectangle(cornerRadius: 18))
        }.buttonStyle(TactileButtonStyle()).foregroundStyle(Brand.ink)
    }

    @ViewBuilder private func sheetContent(_ value: FriendsPanel) -> some View {
        switch value {
        case .profile:
            FriendsProfileForm(profile: model.snapshot?.profile, busy: model.working) { profile in
                Task { if await model.act(FriendsActionRequest(action: .saveProfile, nickname: profile.nickname, shareStats: profile.shareStats, shareArrival: profile.shareArrival), parcels: parcels.parcels) != nil { panel = nil } }
            }
            Button(text("friends.disable")) { panel = .disable }.font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 44)
        case .disable:
            Text(text("friends.disableDetail")).font(.subheadline).foregroundStyle(.secondary)
            Button(text("friends.disable")) { Task { if await model.act(FriendsActionRequest(action: .disable), parcels: parcels.parcels) != nil { panel = nil } } }.buttonStyle(.borderedProminent).disabled(model.working).tint(Brand.accent).foregroundStyle(Brand.onAccent)
        case .invite, .accept:
            if session.isDemo { Text(text("friends.demoInvites")).font(.subheadline).foregroundStyle(.secondary) }
            else { FriendsInvitationView(accepting: value.id == "accept", busy: model.working, act: { await model.act($0, parcels: parcels.parcels) }, completed: { panel = nil; if value.id == "accept" { joined = true } }) }
        case .friend(let initial):
            if let friend = model.snapshot?.friends.first(where: { $0.id == initial.id }) {
                FriendDetailView(friend: friend, busy: model.working) {
                    Task { if await model.act(FriendsActionRequest(action: .removeFriend, friendID: friend.id), parcels: parcels.parcels) != nil { panel = nil } }
                }
            }
        }
    }
    private func errorView(_ key: String) -> some View { Text(text(key)).font(.subheadline).foregroundStyle(ExperimentalPalette.pickup).padding(14).frame(maxWidth: .infinity, alignment: .leading).background(ExperimentalPalette.pickupSurface, in: RoundedRectangle(cornerRadius: 16)) }
}

private enum FriendsPanel: Identifiable {
    case profile, invite, accept, disable, friend(FriendCard)
    var id: String { switch self { case .profile: "profile"; case .invite: "invite"; case .accept: "accept"; case .disable: "disable"; case .friend(let friend): friend.id.uuidString } }
    @MainActor func title(_ localizer: Localizer) -> String {
        switch self { case .friend(let friend): friend.nickname; case .profile: localizer.text("friends.settings"); case .invite: localizer.text("friends.inviteTitle"); case .accept: localizer.text("friends.enterCode"); case .disable: localizer.text("friends.disableTitle") }
    }
}

private struct FriendCardView: View {
    @EnvironmentObject private var localizer: Localizer
    let friend: FriendCard
    var showsArrow = false
    private var tint: Color { [ExperimentalPalette.transit, ExperimentalPalette.lilac, ExperimentalPalette.pickup, ExperimentalPalette.delivered][tone] }
    private var surface: Color { [ExperimentalPalette.transitSurface, ExperimentalPalette.lilacSurface, ExperimentalPalette.pickupSurface, ExperimentalPalette.deliveredSurface][tone] }
    private var tone: Int { Int(friend.id.uuid.0) % 4 }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Text(String(friend.nickname.prefix(1))).font(.headline).frame(width: 38, height: 38).background(Brand.paper, in: Circle()).foregroundStyle(tint).accessibilityHidden(true)
                Text(friend.nickname).font(.title3.bold()).lineLimit(2)
                Spacer(minLength: 0)
                if showsArrow { Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(tint) }
            }
            if let stats = friend.stats {
                HStack(spacing: 32) {
                    metric(stats.deliveredCount.formatted(), "passport.delivered")
                    metric(stats.averageDays.map { localizer.text($0 == 1 ? "friends.day" : "friends.days", ["count": $0]) } ?? "—", "passport.average")
                }
                HStack(spacing: 8) { ForEach(stats.stamps) { stamp in Image(systemName: stamp.symbol).font(.caption).frame(width: 28, height: 28).overlay(Circle().stroke(tint.opacity(0.7), style: StrokeStyle(lineWidth: 0.7, dash: [2, 2]))).accessibilityLabel(localizer.text(stamp.titleKey)) } }.foregroundStyle(tint)
            } else { Label(localizer.text("friends.privateStats"), systemImage: "lock").font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 20) }
            if friend.arrivedThisWeek == true {
                Divider()
                Label(localizer.text("friends.arrived"), systemImage: "circle.fill").font(.caption).foregroundStyle(tint)
            }
        }
        .foregroundStyle(Brand.ink).padding(22).frame(maxWidth: .infinity, alignment: .leading).background(surface, in: RoundedRectangle(cornerRadius: 24))
    }
    private func metric(_ value: String, _ key: String) -> some View { VStack(alignment: .leading, spacing: 4) { Text(value).font(.title2.bold().monospacedDigit()); Text(localizer.text(key)).font(.caption).foregroundStyle(.secondary) } }
}

private struct FriendsProfileForm: View {
    @EnvironmentObject private var localizer: Localizer
    @EnvironmentObject private var parcels: ParcelStore
    let profile: FriendProfile?
    let busy: Bool
    let save: (FriendProfile) -> Void
    @State private var name: String
    @State private var stats: Bool
    @State private var arrival: Bool
    init(profile: FriendProfile?, busy: Bool, save: @escaping (FriendProfile) -> Void) {
        self.profile = profile; self.busy = busy; self.save = save
        _name = State(initialValue: profile?.nickname ?? "")
        _stats = State(initialValue: profile?.shareStats ?? true)
        _arrival = State(initialValue: profile?.shareArrival ?? false)
    }
    private var value: FriendProfile { FriendProfile(nickname: name.trimmingCharacters(in: .whitespacesAndNewlines), shareStats: stats, shareArrival: arrival) }
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                Text(localizer.text("friends.nickname")).font(.subheadline.weight(.semibold))
                TextField(localizer.text("friends.nicknamePlaceholder"), text: $name).textContentType(.nickname).padding(14).background(Brand.paper, in: RoundedRectangle(cornerRadius: 14))
                    .onChange(of: name) { _, next in if next.unicodeScalars.count > 24 { name = String(String.UnicodeScalarView(next.unicodeScalars.prefix(24))) } }
            }
            toggle("friends.shareStats", detail: "friends.shareStatsDetail", value: $stats)
            toggle("friends.shareArrival", detail: "friends.shareArrivalDetail", value: $arrival)
            Text(localizer.text("friends.preview").uppercased()).font(.caption2.monospaced()).tracking(1.2)
            FriendCardView(friend: FriendsStore.ownCard(parcels: parcels.parcels, profile: FriendProfile(nickname: value.nickname.isEmpty ? localizer.text("friends.you") : value.nickname, shareStats: stats, shareArrival: arrival)))
            Label(localizer.text("friends.privacy"), systemImage: "lock").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button { save(value) } label: { Text(localizer.text(profile == nil ? "friends.join" : "friends.save")).frame(maxWidth: .infinity, minHeight: 46) }
                .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent).disabled(busy || value.nickname.isEmpty)
        }.disabled(busy)
    }
    private func toggle(_ title: String, detail: String, value: Binding<Bool>) -> some View {
        Toggle(isOn: value) { VStack(alignment: .leading, spacing: 5) { Text(localizer.text(title)).font(.subheadline.weight(.semibold)); Text(localizer.text(detail)).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) } }.tint(ExperimentalPalette.delivered)
    }
}

private struct FriendsInvitationView: View {
    @EnvironmentObject private var localizer: Localizer
    let accepting: Bool
    let busy: Bool
    let act: (FriendsActionRequest) async -> FriendsActionResponse?
    let completed: () -> Void
    @State private var code = ""
    @State private var name: String?
    @State private var copied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if accepting {
                TextField(localizer.text("friends.codePlaceholder"), text: $code).accessibilityLabel(localizer.text("friends.code")).textInputAutocapitalization(.never).autocorrectionDisabled().font(.footnote.monospaced()).padding(14).background(Brand.paper, in: RoundedRectangle(cornerRadius: 14))
                    .onChange(of: code) { _, next in code = String(next.lowercased().filter { !$0.isWhitespace }.prefix(64)); name = nil }
                if let name {
                    Text(localizer.text("friends.invitedBy", ["name": name])).font(.title3.bold())
                    Text(localizer.text("friends.privacy")).font(.caption).foregroundStyle(.secondary)
                    actionButton("friends.accept") { if await act(FriendsActionRequest(action: .acceptInvite, code: code)) != nil { completed() } }
                } else { actionButton("friends.checkCode") { name = await act(FriendsActionRequest(action: .previewInvite, code: code))?.previewNickname }.disabled(code.range(of: "^[a-f0-9]{32}$", options: .regularExpression) == nil) }
            } else {
                Text(localizer.text("friends.inviteHint")).font(.subheadline).foregroundStyle(.secondary)
                if code.isEmpty { actionButton("friends.invite") { code = await act(FriendsActionRequest(action: .createInvite))?.inviteCode ?? "" } }
                else {
                    Text(code).font(.footnote.monospaced()).textSelection(.enabled).padding(14).frame(maxWidth: .infinity).background(Brand.paper, in: RoundedRectangle(cornerRadius: 14))
                    Text(localizer.text("friends.inviteExpiry")).font(.caption).foregroundStyle(.secondary)
                    Button { UIPasteboard.general.string = code; copied = true } label: { Label(localizer.text(copied ? "friends.copied" : "friends.copyCode"), systemImage: copied ? "checkmark" : "doc.on.doc").frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
                    ShareLink(item: code) { Image(systemName: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 44) }.accessibilityLabel(localizer.text("friends.invite"))
                    Button(localizer.text("friends.revoke")) { Task { if await act(FriendsActionRequest(action: .revokeInvite)) != nil { completed() } } }.font(.footnote).frame(maxWidth: .infinity)
                }
            }
        }.disabled(busy)
    }
    private func actionButton(_ key: String, action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: { Text(localizer.text(key)).frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
    }
}

private struct FriendDetailView: View {
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let friend: FriendCard
    let busy: Bool
    let remove: () -> Void
    @State private var stamp: FriendStamp?
    @State private var confirming = false
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            FriendCardView(friend: friend)
            if let stats = friend.stats, !stats.stamps.isEmpty {
                Text(localizer.text("friends.stampHint")).font(.caption).foregroundStyle(.secondary)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 64))], spacing: 16) {
                    ForEach(stats.stamps) { value in
                        Button { withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.65)) { stamp = value } } label: {
                            FriendsPostage(symbol: value.symbol).scaleEffect(stamp == value && !reduceMotion ? 1.08 : 1).rotationEffect(.degrees(stamp == value && !reduceMotion ? -5 : 0))
                        }.buttonStyle(.plain).accessibilityLabel(localizer.text(value.titleKey)).accessibilityAddTraits(stamp == value ? .isSelected : [])
                    }
                }
                if let stamp { VStack(alignment: .leading, spacing: 8) { Text(localizer.text(stamp.titleKey)).font(.headline); Text(localizer.text(stamp.explanationKey)).font(.subheadline).foregroundStyle(.secondary) } }
            }
            if confirming {
                Divider()
                Text(localizer.text("friends.removeTitle", ["name": friend.nickname])).font(.headline)
                Text(localizer.text("friends.removeDetail")).font(.subheadline).foregroundStyle(.secondary)
                Button(localizer.text("friends.remove"), action: remove).buttonStyle(.bordered).disabled(busy)
                Button(localizer.text("common.cancel")) { confirming = false }
            } else { Button(localizer.text("friends.remove")) { confirming = true }.font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 44) }
        }.sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: stamp)
    }
}

private struct FriendsPostage: View {
    let symbol: String
    var body: some View {
        ZStack {
            PostageStampShape().fill(Color(hex: "#FFF9E8"))
            Rectangle().fill(Brand.accent.opacity(0.24)).overlay(Rectangle().stroke(Brand.onAccent.opacity(0.3), lineWidth: 0.7)).padding(8)
            Image(systemName: symbol).font(.system(size: 25, weight: .regular)).foregroundStyle(Brand.onAccent)
        }.frame(width: 62, height: 76).accessibilityHidden(true)
    }
}
private struct FriendsPostagePair: View {
    var body: some View { HStack(spacing: -14) { FriendsPostage(symbol: "shippingbox").rotationEffect(.degrees(-12)); FriendsPostage(symbol: "person.2").rotationEffect(.degrees(10)).offset(y: -8) }.padding(10).accessibilityHidden(true) }
}
