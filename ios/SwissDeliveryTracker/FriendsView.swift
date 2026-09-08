import SwiftUI
import UIKit

struct FriendsView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var parcels: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @EnvironmentObject private var invitation: FriendInvitationStore
    @EnvironmentObject private var activity: FriendsActivityStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var model = FriendsStore()
    @State private var showingAccount = false
    @State private var visible = false
    @State private var panel: FriendsPanel?
    @State private var arrivingID: UUID?
    @State private var cardLanded = false
    @State private var presented: UUID?
    @State private var checkedPresentation: UUID?
    private var focusReady: Bool { active && model.snapshot?.friends.contains(where: { $0.id == activity.focusID }) == true }
    private var active: Bool { visible && scenePhase == .active }
    private func text(_ key: String) -> String { localizer.text(key) }

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let error = model.errorKey, panel == nil { errorView(error) }
                    if let data = model.snapshot {
                        if let friendID = activity.focusID, checkedPresentation == activity.presentationID, !data.friends.contains(where: { $0.id == friendID }) {
                            Text(text("friends.friendUnavailable")).font(.footnote).foregroundStyle(.secondary)
                        }
                        if data.profile != nil { circle(data) }
                        else {
                            HStack(spacing: 16) {
                                Text(text("friends.joinTitle")).font(.system(.title2, design: .rounded, weight: .bold)).tracking(-0.5)
                                Spacer(minLength: 0)
                                FriendsPostagePair().scaleEffect(0.75).frame(width: 96, height: 76)
                            }
                            FriendsProfileForm(profile: nil, busy: model.working) { profile in
                                Task { _ = await model.act(FriendsActionRequest(action: .saveProfile, nickname: profile.nickname, shareStats: profile.shareStats, shareArrival: profile.shareArrival), parcels: parcels.parcels) }
                            }
                        }
                    } else if model.errorKey != nil {
                        Button(text("common.retry")) { Task { await model.load(parcels: parcels.parcels) } }.buttonStyle(.bordered)
                    } else { ProgressView().frame(maxWidth: .infinity, minHeight: 260) }
                }
                .padding(20).frame(maxWidth: 680).frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden).background(Brand.background)
            .safeAreaInset(edge: .top, spacing: 0) { DemoModeBar() }
            .navigationTitle(text("friends.title")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountToolbarButton { showingAccount = true } } }
            .refreshable { await model.load(parcels: parcels.parcels) }
            .task(id: focusReady ? activity.presentationID.uuidString : "waiting") {
                guard focusReady, presented != activity.presentationID, let friendID = activity.focusID else { return }
                arrivingID = friendID; cardLanded = false
                activity.consumeArrival()
                guard model.snapshot?.friends.contains(where: { $0.id == friendID }) == true, !Task.isCancelled else { return }
                do {
                    try await Task.sleep(for: .milliseconds(60))
                    scroll.scrollTo(friendID, anchor: .center)
                    try await Task.sleep(for: .milliseconds(60))
                    presented = activity.presentationID
                    withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.55, dampingFraction: 0.78)) { cardLanded = true }
                    await activity.acknowledge(friendID, session: session)
                    activity.consumeFocus(friendID)
                } catch { }
            }
            }
        }
        .onAppear {
            visible = true; model.configure(session: session)
            if let seed = activity.arrivalSnapshot { model.seed(seed) }
        }
        .onDisappear { visible = false; panel = nil; arrivingID = nil; model.clear() }
        .task(id: active ? activity.presentationID.uuidString : "hidden") {
            guard active else { panel = nil; model.clear(); return }
            while !Task.isCancelled {
                await model.load(parcels: parcels.parcels)
                guard !Task.isCancelled else { return }
                checkedPresentation = activity.presentationID
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
    }

    @ViewBuilder private func circle(_ data: FriendsSnapshot) -> some View {
        let people = [data.ownCard].compactMap { $0 } + data.friends
        let total = people.reduce(0) { $0 + ($1.stats?.stamps.count ?? 0) }
        let featured = data.friends.first { $0.id == (arrivingID ?? activity.focusID) }
        let remaining = data.friends.filter { $0.id != featured?.id }
        if let featured { friendButton(featured) }
        if let profile = data.profile {
            Button { panel = .profile } label: {
                FriendCardView(friend: data.ownCard ?? FriendsStore.ownCard(parcels: parcels.parcels, profile: profile), showsSettings: true, showsSharingStatus: true)
            }.buttonStyle(TactileButtonStyle(scale: 0.985))
                .accessibilityHint(text("friends.settings"))
        }
        if data.friends.isEmpty {
            Text(text("friends.emptyTitle")).font(.system(.title3, design: .rounded, weight: .bold)).padding(.top, 4)
        } else {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(total.formatted()).font(.system(size: 48, weight: .bold, design: .rounded)).tracking(-2).contentTransition(.numericText())
                    Text(text("friends.collectionNote")).font(.subheadline)
                }
                Spacer(minLength: 0)
                FriendsPostagePair().scaleEffect(0.82).frame(width: 110, height: 90)
            }
            .padding(22).foregroundStyle(Brand.onAccent).background(Brand.accent, in: RoundedRectangle(cornerRadius: 26))
        }
        VStack(spacing: 4) {
            Button { panel = .invite } label: { Label(text("friends.invite"), systemImage: "plus").frame(maxWidth: .infinity, minHeight: 48) }
                .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
            Button(text("friends.enterCode")) { panel = .accept }.font(.subheadline).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 44)
        }
        if !remaining.isEmpty {
            HStack { Text(text("friends.circle")).font(.title2.bold()); Spacer(); Text(session.isDemo ? text("friends.demoPeople") : data.friends.count.formatted()).font(.caption).foregroundStyle(.secondary) }
            ForEach(remaining) { friendButton($0) }
        }
    }

    private func friendButton(_ friend: FriendCard) -> some View {
        Button { panel = .friend(friend) } label: { FriendCardView(friend: friend, showsArrow: true) }
            .buttonStyle(TactileButtonStyle(scale: 0.98)).id(friend.id)
            .offset(x: friend.id == (arrivingID ?? activity.focusID) && !cardLanded && !reduceMotion ? 100 : 0)
            .opacity(friend.id == (arrivingID ?? activity.focusID) && !cardLanded ? 0 : 1)
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
            if session.isDemo {
                Text(text("friends.demoInvites")).font(.subheadline).foregroundStyle(.secondary)
                Button {
                    panel = nil
                    model.errorKey = nil
                    session.showWelcome()
                } label: {
                    Text(text("welcome.signInInstead")).frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
                .accessibilityIdentifier("friends.demoSignIn")
            }
            else { FriendsInvitationView(accepting: value.id == "accept", busy: model.working, act: { await model.act($0, parcels: parcels.parcels) }, completed: { panel = nil }, open: { url in panel = nil; invitation.open(url) }) }
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let friend: FriendCard
    var showsArrow = false
    var showsSettings = false
    var showsSharingStatus = false
    var magicTrigger = 0
    @State private var appeared = false
    private var tint: Color { [ExperimentalPalette.transit, ExperimentalPalette.lilac, ExperimentalPalette.pickup, ExperimentalPalette.delivered][tone] }
    private var surface: Color { [ExperimentalPalette.transitSurface, ExperimentalPalette.lilacSurface, ExperimentalPalette.pickupSurface, ExperimentalPalette.deliveredSurface][tone] }
    private var tone: Int { Int(friend.id.uuid.0) % 4 }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                ZStack(alignment: .topTrailing) {
                    Text(String(friend.nickname.prefix(1))).font(.system(.title2, design: .rounded, weight: .bold))
                        .frame(width: 42, height: 48).background(Brand.paper, in: PostageStampShape())
                        .overlay(Rectangle().stroke(tint.opacity(0.25), lineWidth: 0.7).padding(6))
                        .rotationEffect(.degrees(reduceMotion ? -4 : appeared ? -4 : -10))
                    Image(systemName: "sparkle").font(.system(size: 12, weight: .medium)).offset(x: 6, y: -3)
                        .phaseAnimator([false, true, false], trigger: magicTrigger) { content, bright in
                            content.scaleEffect(bright && !reduceMotion ? 1.3 : 1).opacity(bright ? 1 : 0.5)
                        } animation: { _ in .easeInOut(duration: 0.24) }
                }.foregroundStyle(tint).accessibilityHidden(true)
                    .phaseAnimator([false, true, false], trigger: magicTrigger) { content, lifted in
                        content.offset(y: lifted && !reduceMotion ? -3 : 0).rotationEffect(.degrees(lifted && !reduceMotion ? 3 : 0))
                    } animation: { _ in .spring(response: 0.3, dampingFraction: 0.6) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(localizer.text("passport.title")).font(.caption2).foregroundStyle(tint).accessibilityHidden(true)
                    Text(friend.nickname).font(.system(.title3, design: .rounded, weight: .bold)).lineLimit(2)
                }
                Spacer(minLength: 0)
                if showsSettings || showsArrow { Image(systemName: showsSettings ? "slider.horizontal.3" : "arrow.up.right").font(.subheadline).foregroundStyle(tint) }
            }
            VStack(alignment: .leading, spacing: 8) {
                if let stats = friend.stats {
                    HStack(alignment: .top, spacing: 32) {
                        metric(stats.deliveredCount.formatted(), "passport.delivered")
                        metric(stats.averageDays.map { localizer.text($0 == 1 ? "friends.day" : "friends.days", ["count": $0]) } ?? "—", "passport.average")
                    }
                    HStack(spacing: 7) {
                        ForEach(Array(stats.stamps.enumerated()), id: \.element) { index, stamp in
                            Image(systemName: stamp.symbol).font(.system(size: 12)).frame(width: 25, height: 28)
                                .background(tint.opacity(0.09), in: PostageStampShape())
                                .rotationEffect(.degrees(index.isMultiple(of: 2) ? -4 : 3))
                                .offset(y: appeared || reduceMotion ? 0 : 4).opacity(appeared ? 1 : 0)
                                .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.7).delay(Double(index) * 0.055), value: appeared)
                                .transition(.opacity.combined(with: .scale(scale: reduceMotion ? 1 : 0.85)))
                                .accessibilityLabel(localizer.text(stamp.titleKey))
                        }
                    }.foregroundStyle(tint).frame(minHeight: 28)
                } else {
                    Label(localizer.text("friends.privateStats"), systemImage: "lock").font(.footnote).foregroundStyle(.secondary)
                }
            }.frame(minHeight: 76, alignment: .leading)
            if friend.arrivedThisWeek == true || showsSharingStatus {
                Label(localizer.text(friend.arrivedThisWeek == true ? "friends.arrived" : friend.arrivedThisWeek == false ? "friends.noArrival" : "friends.privateArrival"), systemImage: friend.arrivedThisWeek == nil ? "lock" : "shippingbox")
                    .font(.caption).foregroundStyle(friend.arrivedThisWeek == true ? tint : Brand.ink.opacity(0.65))
                    .padding(.top, 10).frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) { Rectangle().fill(tint.opacity(0.18)).frame(height: 0.5) }
            }
        }
        .foregroundStyle(Brand.ink).padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(surface, in: RoundedRectangle(cornerRadius: 24))
        .overlay { RoundedRectangle(cornerRadius: 24).strokeBorder(tint.opacity(0.12), lineWidth: 0.7) }
        .animation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.85), value: friend.stats != nil)
        .onAppear { withAnimation(reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 0.6)) { appeared = true } }
    }
    private func metric(_ value: String, _ key: String) -> some View { VStack(alignment: .leading, spacing: 4) { Text(value).font(.title2.bold().monospacedDigit()); Text(localizer.text(key)).font(.caption).foregroundStyle(.secondary) } }
}

struct FriendsProfileForm: View {
    @EnvironmentObject private var localizer: Localizer
    @EnvironmentObject private var parcels: ParcelStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    let profile: FriendProfile?
    let busy: Bool
    let submitKey: String?
    let save: (FriendProfile) -> Void
    @State private var name: String
    @State private var stats: Bool
    @State private var arrival: Bool
    @State private var magicTrigger = 0
    @State private var settledName: String?
    @FocusState private var nameFocused: Bool
    init(profile: FriendProfile?, busy: Bool, submitKey: String? = nil, save: @escaping (FriendProfile) -> Void) {
        self.profile = profile; self.busy = busy; self.submitKey = submitKey; self.save = save
        _name = State(initialValue: profile?.nickname ?? "")
        _stats = State(initialValue: profile?.shareStats ?? true)
        _arrival = State(initialValue: profile?.shareArrival ?? true)
    }
    private var value: FriendProfile { FriendProfile(nickname: name.trimmingCharacters(in: .whitespacesAndNewlines), shareStats: stats, shareArrival: arrival) }
    private var invitesAttention: Bool { profile == nil && !busy && !reduceMotion && scenePhase == .active }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text(localizer.text("friends.nickname")).font(.subheadline.weight(.semibold))
                TextField(localizer.text("friends.nicknamePlaceholder"), text: $name).textContentType(.nickname).padding(14).background(Brand.paper, in: RoundedRectangle(cornerRadius: 14))
                    .focused($nameFocused).submitLabel(.done).onSubmit { nameFocused = false }
                    .modifier(FriendsAttentionCue(active: invitesAttention && value.nickname.isEmpty && !nameFocused, cornerRadius: 14, growth: 0.01))
                    .onChange(of: name) { _, next in
                        settledName = nil
                        if next.unicodeScalars.count > 24 { name = String(String.UnicodeScalarView(next.unicodeScalars.prefix(24))) }
                    }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(localizer.text("friends.preview")).font(.subheadline).foregroundStyle(.secondary)
                Button { magicTrigger += 1 } label: {
                    FriendCardView(friend: FriendsStore.ownCard(parcels: parcels.parcels, profile: FriendProfile(nickname: value.nickname.isEmpty ? localizer.text("friends.you") : value.nickname, shareStats: stats, shareArrival: arrival)), showsSharingStatus: true, magicTrigger: magicTrigger)
                }.buttonStyle(TactileButtonStyle(scale: 0.99))
            }
            HStack(alignment: .top, spacing: 16) {
                toggle("friends.shareStats", detail: "friends.shareStatsDetail", value: $stats)
                toggle("friends.shareArrival", detail: "friends.shareArrivalDetail", value: $arrival)
            }
            Label(localizer.text("friends.privacy"), systemImage: "lock").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button { save(value) } label: { Text(localizer.text(submitKey ?? (profile == nil ? "friends.join" : "friends.save"))).frame(maxWidth: .infinity, minHeight: 46) }
                .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent).disabled(busy || value.nickname.isEmpty)
                .modifier(FriendsAttentionCue(active: invitesAttention && !value.nickname.isEmpty && settledName == value.nickname, cornerRadius: 100, growth: 0.016))
        }.disabled(busy)
            .sensoryFeedback(.impact(weight: .light, intensity: 0.5), trigger: magicTrigger)
            .onChange(of: stats) { _, _ in magicTrigger += 1 }
            .onChange(of: arrival) { _, _ in magicTrigger += 1 }
            .task(id: name) {
                guard profile == nil, !value.nickname.isEmpty else { return }
                do { try await Task.sleep(for: .milliseconds(900)) } catch { return }
                guard !Task.isCancelled else { return }
                settledName = value.nickname
            }
    }
    private func toggle(_ title: String, detail: String, value: Binding<Bool>) -> some View {
        Toggle(isOn: value) { Text(localizer.text(title)).font(.footnote).foregroundStyle(.secondary) }
            .toggleStyle(FriendsSharingToggleStyle()).frame(maxWidth: .infinity, alignment: .leading).accessibilityHint(localizer.text(detail))
    }
}

/// Keep the control mounted while its repeating cue starts and stops, preserving text focus.
private struct FriendsAttentionCue: ViewModifier {
    let active: Bool
    let cornerRadius: CGFloat
    let growth: CGFloat
    @State private var startedAt = Date()
    func body(content: Content) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !active)) { context in
            let phase = max(0, context.date.timeIntervalSince(startedAt) - 0.2).truncatingRemainder(dividingBy: 2.6)
            let breath = active && phase < 1.6 ? pow(sin(phase / 1.6 * .pi), 2) : 0
            content.scaleEffect(1 + growth * breath)
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(Brand.accent.opacity(0.85 * breath), lineWidth: 1.8)
                        .padding(-2 - 2.5 * breath)
                        .allowsHitTesting(false).accessibilityHidden(true)
                }
        }
        .onChange(of: active) { _, next in if next { startedAt = .now } }
    }
}

private struct FriendsSharingToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: 7) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 17)).foregroundStyle(configuration.isOn ? ExperimentalPalette.delivered : Brand.ink.opacity(0.45))
                configuration.label.fixedSize(horizontal: false, vertical: true)
            }.frame(minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain)
            .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label }.toggleStyle(.switch) }
    }
}

private struct FriendsInvitationView: View {
    @EnvironmentObject private var localizer: Localizer
    let accepting: Bool
    let busy: Bool
    let act: (FriendsActionRequest) async -> FriendsActionResponse?
    let completed: () -> Void
    let open: (URL) -> Void
    @State private var code = ""
    @State private var copied = false
    @State private var requestedInvitation = false
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if accepting {
                TextField(localizer.text("friends.linkPlaceholder"), text: $code).accessibilityLabel(localizer.text("friends.link")).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).font(.footnote).padding(14).background(Brand.paper, in: RoundedRectangle(cornerRadius: 14))
                    .onChange(of: code) { _, next in code = String(next.prefix(2048)) }
                Button(localizer.text("friends.openLink")) { if let url = URL(string: code.trimmingCharacters(in: .whitespacesAndNewlines)) { open(url) } }
                    .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent).disabled(FriendInvitationLink.code(from: code) == nil)
            } else {
                Text(localizer.text("friends.inviteHint")).font(.subheadline).foregroundStyle(.secondary)
                if code.isEmpty {
                    if !requestedInvitation || busy {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 44)
                            .accessibilityLabel(localizer.text("friends.link"))
                    } else {
                        actionButton("common.retry") { await createInvitation() }
                    }
                }
                else {
                    let link = FriendInvitationLink.url(code: code)
                    ShareLink(item: link) { Label(localizer.text("friends.shareLink"), systemImage: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 44) }
                        .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
                    Text(localizer.text("friends.inviteExpiry")).font(.caption).foregroundStyle(.secondary)
                    Button { UIPasteboard.general.url = link; copied = true } label: { Label(localizer.text(copied ? "friends.copied" : "friends.copyLink"), systemImage: copied ? "checkmark" : "doc.on.doc").frame(maxWidth: .infinity, minHeight: 44) }.foregroundStyle(Brand.ink)
                    Button(localizer.text("friends.revoke")) { Task { if await act(FriendsActionRequest(action: .revokeInvite)) != nil { completed() } } }.font(.footnote).frame(maxWidth: .infinity)
                }
            }
        }.disabled(busy)
        .task {
            guard !accepting, !requestedInvitation else { return }
            requestedInvitation = true
            await createInvitation()
        }
    }
    private func createInvitation() async {
        let result = await act(FriendsActionRequest(action: .createInvite))
        guard !Task.isCancelled else { return }
        code = result?.inviteCode ?? ""
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

struct FriendAcceptedNotice: View {
    let update: FriendUpdate
    let open: () -> Void
    let dismiss: () -> Void
    @EnvironmentObject private var localizer: Localizer
    var body: some View {
        HStack(spacing: 8) {
            Button(action: open) {
                HStack(spacing: 12) {
                    Image(systemName: "person.2.fill").font(.title3).foregroundStyle(ExperimentalPalette.delivered)
                    Text(localizer.text("friends.invitationAccepted", ["name": update.nickname]))
                        .font(.subheadline.weight(.medium)).multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    Image(systemName: "arrow.right").font(.caption.weight(.semibold))
                }.frame(minHeight: 44)
            }.buttonStyle(.plain)
            Button(action: dismiss) { Image(systemName: "xmark").frame(width: 32, height: 44) }
                .buttonStyle(.plain).accessibilityLabel(localizer.text("friends.dismissUpdate"))
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .foregroundStyle(Brand.ink).background(Brand.paper, in: RoundedRectangle(cornerRadius: 22))
        .overlay { RoundedRectangle(cornerRadius: 22).stroke(Brand.ink.opacity(0.08)) }
        .shadow(color: .black.opacity(0.12), radius: 18, y: 6)
        .frame(maxWidth: 520)
    }
}
