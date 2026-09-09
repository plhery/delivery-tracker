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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @StateObject private var model = FriendsStore()
    @State private var showingAccount = false
    @State private var visible = false
    @State private var panel: FriendsPanel?
    @State private var noticeKey: String?
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
                    if let noticeKey {
                        Label(text(noticeKey), systemImage: "checkmark.circle")
                            .font(.subheadline).foregroundStyle(ExperimentalPalette.delivered)
                    }
                    if let data = model.snapshot {
                        if let friendID = activity.focusID, checkedPresentation == activity.presentationID, !data.friends.contains(where: { $0.id == friendID }) {
                            Text(text("friends.friendUnavailable")).font(.footnote).foregroundStyle(.secondary)
                        }
                        if data.profile != nil { circle(data) }
                        else {
                            VStack(spacing: 22) {
                                FriendsPostagePair().padding(.bottom, 12)
                                Text(text("friends.title")).font(.system(size: 26, weight: .semibold))
                                Text(text("friends.introSummary")).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                                Button { panel = .create } label: { Text(text("friends.join")).frame(maxWidth: .infinity, minHeight: 46) }
                                    .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
                            }.padding(.vertical, 70).frame(maxWidth: .infinity)
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
        .onDisappear { visible = false; panel = nil; noticeKey = nil; arrivingID = nil; model.clear() }
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
        .onChange(of: model.working) { _, working in if working { noticeKey = nil } }
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
            .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : value.detents)
            .presentationDragIndicator(.visible).interactiveDismissDisabled(model.working)
        }
    }

    @ViewBuilder private func circle(_ data: FriendsSnapshot) -> some View {
        let featured = data.friends.first { $0.id == (arrivingID ?? activity.focusID) }
        let remaining = data.friends.filter { $0.id != featured?.id }
        if let profile = data.profile {
            Button { panel = .profile } label: {
                HStack(spacing: 12) {
                    FriendAvatarView(name: profile.nickname, tint: ExperimentalPalette.transit, surface: ExperimentalPalette.transitSurface).frame(width: 31, height: 38)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(text("friends.yourSharing")).font(.subheadline.weight(.medium)).foregroundStyle(Brand.ink)
                        Text(text(profile.shareStats ? "friends.shareStats" : "friends.privateStats") + (profile.shareArrival ? " · " + text("friends.shareArrival") : "")).font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 6)
                    Image(systemName: "slider.horizontal.3").font(.footnote).foregroundStyle(.secondary)
                }.padding(.bottom, 18).frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .bottom) { Divider() }
            }.buttonStyle(.plain).accessibilityLabel(text("friends.settings"))
        }
        if data.friends.isEmpty {
            VStack(spacing: 24) {
                FriendsPostagePair()
                Text(text("friends.emptyTitle")).font(.title3.weight(.semibold))
                Button { noticeKey = nil; panel = .invite } label: { Label(text("friends.invite"), systemImage: "plus").frame(maxWidth: .infinity, minHeight: 46) }
                    .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
            }.padding(.vertical, 45).frame(maxWidth: .infinity)
        } else {
            HStack(alignment: .center) {
                HStack(alignment: .firstTextBaseline, spacing: 4) { Text(text("friends.circle")).font(.subheadline.weight(.semibold)); Text(data.friends.count.formatted()).font(.caption2).foregroundStyle(.secondary) }
                Spacer(minLength: 8)
                Button { noticeKey = nil; panel = .invite } label: { Label(text("friends.invite"), systemImage: "plus").font(.caption.weight(.medium)).padding(.horizontal, 10).frame(minHeight: 36) }
                    .buttonStyle(.plain).foregroundStyle(Brand.onAccent).background(Brand.accent, in: RoundedRectangle(cornerRadius: 11))
            }
            VStack(spacing: 9) {
                if let featured { friendButton(featured) }
                ForEach(remaining) { friendButton($0) }
            }
        }
    }

    private func friendButton(_ friend: FriendCard) -> some View {
        Button { DeliveryAnalytics.shared.action("friend-open"); panel = .friend(friend) } label: { FriendCardView(friend: friend) }
            .buttonStyle(TactileButtonStyle(scale: 0.98)).id(friend.id)
            .offset(x: friend.id == (arrivingID ?? activity.focusID) && !cardLanded && !reduceMotion ? 100 : 0)
            .opacity(friend.id == (arrivingID ?? activity.focusID) && !cardLanded ? 0 : 1)
    }

    @ViewBuilder private func sheetContent(_ value: FriendsPanel) -> some View {
        switch value {
        case .profile, .create:
            FriendsProfileForm(profile: value.id == "create" ? nil : model.snapshot?.profile, busy: model.working) { profile in
                Task { if await model.act(FriendsActionRequest(action: .saveProfile, nickname: profile.nickname, shareStats: profile.shareStats, shareArrival: profile.shareArrival), parcels: parcels.parcels) != nil { panel = nil } }
            }
        case .invite:
            if session.isDemo {
                FriendsInvitationParcel(nickname: model.snapshot?.profile?.nickname ?? text("friends.you"))
                Text(text("friends.demoInvites")).font(.subheadline).foregroundStyle(.secondary)
                Button { panel = nil; model.errorKey = nil; session.showWelcome() } label: { Text(text("welcome.signInInstead")).frame(maxWidth: .infinity, minHeight: 46) }
                    .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent).accessibilityIdentifier("friends.demoSignIn")
            } else {
                FriendsInvitationView(nickname: model.snapshot?.profile?.nickname ?? text("friends.you"), busy: model.working, act: { await model.act($0, parcels: parcels.parcels) }, completed: { panel = nil })
            }
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
    case profile, create, invite, friend(FriendCard)
    var id: String { switch self { case .profile: "profile"; case .create: "create"; case .invite: "invite"; case .friend(let friend): friend.id.uuidString } }
    var detents: Set<PresentationDetent> { if case .invite = self { [.height(590), .large] } else { [.large] } }
    @MainActor func title(_ localizer: Localizer) -> String {
        switch self { case .friend: localizer.text("passport.title"); case .profile: localizer.text("friends.settings"); case .create: localizer.text("friends.join"); case .invite: localizer.text("friends.inviteTitle") }
    }
}

struct FriendAvatarView: View {
    let name: String
    var tint = ExperimentalPalette.lilac
    var surface = ExperimentalPalette.lilacSurface
    var body: some View {
        GeometryReader { geometry in
            Text(String(name.prefix(1))).font(.system(size: geometry.size.width * 0.47, weight: .medium))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(surface.mix(with: tint, by: 0.19), in: PostageStampShape())
                .overlay(Rectangle().stroke(tint.opacity(0.34), lineWidth: 0.7).padding(5))
                .foregroundStyle(tint).rotationEffect(.degrees(-4))
        }.accessibilityHidden(true)
    }
}

private struct FriendCardView: View {
    @EnvironmentObject private var localizer: Localizer
    let friend: FriendCard
    private var tone: Int { Int(friend.id.uuid.0) % 4 }
    private var tint: Color { [ExperimentalPalette.transit, ExperimentalPalette.lilac, ExperimentalPalette.pickup, ExperimentalPalette.delivered][tone] }
    private var surface: Color { [ExperimentalPalette.transitSurface, ExperimentalPalette.lilacSurface, ExperimentalPalette.pickupSurface, ExperimentalPalette.deliveredSurface][tone] }
    var body: some View {
        HStack(spacing: 12) {
            FriendAvatarView(name: friend.nickname, tint: tint, surface: surface).frame(width: 39, height: 48)
            VStack(alignment: .leading, spacing: 4) {
                Text(friend.nickname).font(.system(.title3, weight: .semibold)).foregroundStyle(Brand.ink)
                Text(friend.stats.map { localizer.text("friends.stampCount", ["count": $0.stamps.count]) } ?? localizer.text("friends.privateStats")).font(.caption2).foregroundStyle(tint)
                if friend.arrivedThisWeek == true { HStack(spacing: 5) { Circle().fill(tint).frame(width: 4, height: 4); Text(localizer.text("friends.arrived")).font(.caption2).foregroundStyle(tint) }.padding(.top, 1) }
            }
            Spacer(minLength: 0)
        }.padding(.horizontal, 16).padding(.vertical, 14).frame(maxWidth: .infinity, minHeight: 80, alignment: .leading)
            .background(surface, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct FriendPostcardView: View {
    @EnvironmentObject private var localizer: Localizer
    let nickname: String
    var arrivedThisWeek: Bool? = nil
    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                Text(nickname).font(.system(size: 28, weight: .semibold)).tracking(-1)
                if arrivedThisWeek == true { HStack(spacing: 5) { Circle().fill(ExperimentalPalette.lilac).frame(width: 4, height: 4); Text(localizer.text("friends.arrived")).font(.caption).foregroundStyle(ExperimentalPalette.lilac) } }
            }
            Spacer(minLength: 0)
            FriendAvatarView(name: nickname).frame(width: 61, height: 74)
        }.padding(22).frame(maxWidth: .infinity, minHeight: 135, alignment: .leading).background(ExperimentalPalette.lilacSurface, in: RoundedRectangle(cornerRadius: 21))
    }
}

struct FriendSharingPreviewView: View {
    @EnvironmentObject private var localizer: Localizer
    let friend: FriendCard
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack { Text(friend.nickname).font(.headline).foregroundStyle(Brand.ink); Spacer(minLength: 8); FriendAvatarView(name: friend.nickname, tint: ExperimentalPalette.transit, surface: ExperimentalPalette.transitSurface).frame(width: 33, height: 41) }
            Text(summary).font(.caption2).frame(minHeight: 36, alignment: .topLeading).fixedSize(horizontal: false, vertical: true)
            Text(localizer.text(friend.arrivedThisWeek == true ? "friends.arrived" : "friends.noArrival")).font(.caption2).frame(minHeight: 18).opacity(friend.arrivedThisWeek == nil ? 0 : 1).accessibilityHidden(friend.arrivedThisWeek == nil)
        }.foregroundStyle(ExperimentalPalette.transit).padding(16).frame(maxWidth: .infinity, alignment: .leading).background(ExperimentalPalette.transitSurface, in: RoundedRectangle(cornerRadius: 17))
    }
    private var summary: String {
        guard let stats = friend.stats else { return localizer.text("friends.privateStats") }
        let days = stats.averageDays.map { localizer.text($0 == 1 ? "friends.day" : "friends.days", ["count": $0]) } ?? "—"
        return "\(stats.deliveredCount) \(localizer.text("passport.delivered")) · \(days) · \(localizer.text("friends.stampCount", ["count": stats.stamps.count]))"
    }
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
                    .onChange(of: name) { _, next in
                        settledName = nil
                        if next.unicodeScalars.count > 24 { name = String(String.UnicodeScalarView(next.unicodeScalars.prefix(24))) }
                    }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(localizer.text("friends.preview")).font(.subheadline).foregroundStyle(.secondary)
                FriendSharingPreviewView(friend: FriendsStore.ownCard(parcels: parcels.parcels, profile: FriendProfile(nickname: value.nickname.isEmpty ? localizer.text("friends.you") : value.nickname, shareStats: stats, shareArrival: arrival)))
            }
            VStack(spacing: 0) {
                Divider()
                toggle("friends.shareStats", detail: "friends.sharedStatsSummary", value: $stats)
                Divider()
                toggle("friends.shareArrival", detail: "friends.shareArrivalDetail", value: $arrival)
                Divider()
            }

            Label(localizer.text("friends.privacy"), systemImage: "lock").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button { save(value) } label: { Text(localizer.text(submitKey ?? (profile == nil ? "friends.join" : "friends.save"))).frame(maxWidth: .infinity, minHeight: 46) }
                .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent).disabled(busy || value.nickname.isEmpty)
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
        Toggle(isOn: value) {
            VStack(alignment: .leading, spacing: 3) {
                Text(localizer.text(title)).font(.footnote.weight(.medium))
                if title == "friends.shareStats" { Text(localizer.text(detail)).font(.caption2).foregroundStyle(.secondary) }
            }
        }.toggleStyle(.switch).tint(ExperimentalPalette.delivered).padding(.vertical, 10).accessibilityHint(localizer.text(detail))
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
    let nickname: String
    let busy: Bool
    let act: (FriendsActionRequest) async -> FriendsActionResponse?
    let completed: () -> Void
    @State private var code = ""
    @State private var previewId: String?
    @State private var copied = false
    @State private var requestedInvitation = false
    @State private var previousInviteCount = 0
    @State private var previousInvitationsCancelled = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(localizer.text("friends.inviteExpiry")).font(.caption2).foregroundStyle(.secondary)
            FriendsInvitationParcel(nickname: nickname)
            if code.isEmpty {
                if !requestedInvitation || busy { ProgressView().frame(maxWidth: .infinity, minHeight: 44).accessibilityLabel(localizer.text("friends.link")) }
                else { Button(localizer.text("common.retry")) { Task { await createInvitation() } }.buttonStyle(.borderedProminent) }
            } else {
                let link = FriendInvitationLink.url(code: code, previewId: previewId)
                Text(link.absoluteString).font(.caption2).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(10).background(Brand.ink.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
                    .accessibilityLabel(localizer.text("friends.link") + ": " + link.absoluteString).accessibilityIdentifier("friends.invitationURL")
                ShareLink(item: link) { Label(localizer.text("friends.shareLink"), systemImage: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 44) }
                    .simultaneousGesture(TapGesture().onEnded { DeliveryAnalytics.shared.action("friend-invite-share", .started) })
                    .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
                Button { UIPasteboard.general.url = link; copied = true; DeliveryAnalytics.shared.action("friend-invite-copy", .success) } label: { Label(localizer.text(copied ? "friends.copied" : "friends.copyLink"), systemImage: copied ? "checkmark" : "doc.on.doc").font(.footnote).frame(maxWidth: .infinity, minHeight: 36) }.foregroundStyle(Brand.ink)
                if previousInvitationsCancelled { Label(localizer.text("friends.previousRevoked"), systemImage: "checkmark").font(.caption).foregroundStyle(ExperimentalPalette.delivered) }
                Divider()
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 0) {
                        Button(localizer.text("friends.revoke")) { Task { if await act(FriendsActionRequest(action: .revokeInvite, code: code)) != nil { completed() } } }.frame(minHeight: 30)
                        if previousInviteCount > 0 {
                            Button(localizer.text("friends.cancelPrevious", ["count": previousInviteCount])) {
                                Task { if await act(FriendsActionRequest(action: .revokePreviousInvites, code: code)) != nil { previousInviteCount = 0; previousInvitationsCancelled = true } }
                            }.frame(minHeight: 30)
                        }
                    }.font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                } label: { Text(localizer.text("friends.manageLinks")).font(.caption).foregroundStyle(.secondary) }
            }
        }.disabled(busy).task { guard !requestedInvitation else { return }; requestedInvitation = true; await createInvitation() }
    }
    private func createInvitation() async {
        let result = await act(FriendsActionRequest(action: .createInvite))
        guard !Task.isCancelled else { return }
        previewId = result?.previewID; code = result?.inviteCode ?? ""; previousInviteCount = result?.previousInviteCount ?? 0; previousInvitationsCancelled = false
    }
}

struct FriendsInvitationParcel: View {
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let nickname: String
    @State private var iteration = 0
    @State private var open = 0.0
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 3) { Text(localizer.text("friends.from")).font(.caption2); Text(nickname).font(.subheadline.weight(.semibold)) }.foregroundStyle(ExperimentalPalette.delivered)
            Spacer(minLength: 0)
            Button { iteration += 1 } label: { UnwrappingParcel(open: open, celebrating: open > 0, senderName: nickname).frame(width: 158, height: 163) }
                .buttonStyle(.plain).accessibilityLabel(localizer.text("friends.replayParcel"))
        }.padding(.leading, 17).padding(.trailing, 8).frame(maxWidth: .infinity, minHeight: 157).background(ExperimentalPalette.deliveredSurface, in: RoundedRectangle(cornerRadius: 16)).clipped()
            .task(id: iteration) {
                var transaction = Transaction(); transaction.disablesAnimations = true
                withTransaction(transaction) { open = 0 }
                do { try await Task.sleep(for: .milliseconds(80)) } catch { return }
                withAnimation(reduceMotion ? .linear(duration: 0.1) : .easeOut(duration: 1.5)) { open = 1 }
            }
    }
}

private struct FriendDetailView: View {
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let friend: FriendCard
    let busy: Bool
    let remove: () -> Void
    @State private var showAllStamps = false
    @State private var stamp: FriendStamp?
    @State private var confirming = false
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            FriendPostcardView(nickname: friend.nickname, arrivedThisWeek: friend.arrivedThisWeek)
            if let stats = friend.stats {
                HStack(alignment: .top) {
                    metric(stats.deliveredCount.formatted(), "passport.delivered")
                    metric(stats.averageDays.map { localizer.text($0 == 1 ? "friends.day" : "friends.days", ["count": $0]) } ?? "—", "passport.average")
                }
                Text(localizer.text("passport.stamps")).font(.subheadline.weight(.semibold))
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .top), count: dynamicTypeSize.isAccessibilitySize ? 2 : 4), spacing: 16) {
                    ForEach(visibleStamps(stats.stamps)) { value in
                        let earned = stats.stamps.contains(value)
                        Button { stamp = value } label: {
                            VStack(spacing: 10) {
                                PassportSeal(symbol: value == .ten ? "10" : value == .theRegular ? "25" : value == .busyDoorstep ? "parcels" : value.symbol, tint: stampTint(value), surface: stampSurface(value), earned: earned).frame(width: 50, height: 64)
                                Text(localizer.text(value.titleKey)).font(.caption2).foregroundStyle(earned ? Brand.ink : Brand.ink.opacity(0.6)).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                            }.frame(maxWidth: .infinity, minHeight: 96, alignment: .top)
                        }.buttonStyle(PassportPressStyle()).accessibilityLabel(localizer.text(value.titleKey))
                            .popover(isPresented: Binding(get: { stamp == value }, set: { if !$0 { stamp = nil } })) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(localizer.text(value.titleKey)).font(.headline)
                                    Text(localizer.text(value.explanationKey) + progress(value, earned: earned, count: stats.deliveredCount)).font(.subheadline).foregroundStyle(.secondary)
                                }.fixedSize(horizontal: false, vertical: true).frame(idealWidth: 260, maxWidth: 280, alignment: .leading).padding(20).foregroundStyle(Brand.ink).presentationBackground(Brand.paper).presentationCompactAdaptation(.popover)
                            }
                    }
                }
                if FriendStamp.allCases.filter({ !stats.stamps.contains($0) }).count > 3 {
                    Button(localizer.text(showAllStamps ? "passport.showLess" : "passport.showAll")) { showAllStamps.toggle() }.font(.caption).foregroundStyle(.secondary).frame(minHeight: 44).buttonStyle(PassportPressStyle())
                }
            } else { Label(localizer.text("friends.privateStats"), systemImage: "lock").font(.footnote).foregroundStyle(.secondary) }
            Divider()
            DisclosureGroup {
                if confirming {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(localizer.text("friends.removeTitle", ["name": friend.nickname])).font(.headline)
                        Text(localizer.text("friends.removeDetail")).font(.subheadline).foregroundStyle(.secondary)
                        Button(localizer.text("friends.remove"), action: remove).buttonStyle(.bordered).disabled(busy)
                        Button(localizer.text("common.cancel")) { confirming = false }.disabled(busy)
                    }
                } else { Button(localizer.text("friends.remove")) { confirming = true }.font(.footnote).foregroundStyle(.secondary).frame(minHeight: 36).disabled(busy) }
            } label: { Text(localizer.text("friends.manageFriendship")).font(.caption).foregroundStyle(.secondary) }
        }.sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: stamp)
    }
    private func visibleStamps(_ earned: [FriendStamp]) -> [FriendStamp] {
        let upcoming = Set(FriendStamp.allCases.filter { !earned.contains($0) }.prefix(3))
        return showAllStamps ? FriendStamp.allCases : FriendStamp.allCases.filter { earned.contains($0) || upcoming.contains($0) }
    }
    private func metric(_ value: String, _ title: String) -> some View { VStack(alignment: .leading, spacing: 4) { Text(value).font(.title2.weight(.semibold)); Text(localizer.text(title)).font(.caption2).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading) }
    private func stampTint(_ stamp: FriendStamp) -> Color { switch stamp { case .first, .aroundWorld, .rightNextDoor, .homeForHolidays: ExperimentalPalette.delivered; case .ten, .theRegular: ExperimentalPalette.lilac; case .connected, .acrossBorders, .pickedUp: ExperimentalPalette.transit; case .express, .busyDoorstep: ExperimentalPalette.pickup; case .worthTheWait: ExperimentalPalette.ochre } }
    private func stampSurface(_ stamp: FriendStamp) -> Color { switch stamp { case .first, .aroundWorld, .rightNextDoor, .homeForHolidays: ExperimentalPalette.deliveredSurface; case .ten, .theRegular: ExperimentalPalette.lilacSurface; case .connected, .acrossBorders, .pickedUp: ExperimentalPalette.transitSurface; case .express, .busyDoorstep: ExperimentalPalette.pickupSurface; case .worthTheWait: ExperimentalPalette.ochreSurface } }
    private func progress(_ stamp: FriendStamp, earned: Bool, count: Int) -> String {
        guard !earned else { return "" }
        switch stamp { case .first: return "\n\(min(count, 1)) / 1"; case .ten: return "\n\(min(count, 10)) / 10"; case .express: return "\n" + localizer.text("passport.underTwoDays"); case .theRegular: return "\n\(min(count, 25)) / 25"; default: return "" }
    }
}

private struct FriendsPostagePair: View {
    var body: some View { HStack(spacing: -8) { FriendAvatarView(name: "A", tint: ExperimentalPalette.transit, surface: ExperimentalPalette.transitSurface).frame(width: 70, height: 85).rotationEffect(.degrees(-9)); FriendAvatarView(name: "M").frame(width: 70, height: 85).rotationEffect(.degrees(12)).offset(y: 12) }.padding(10).accessibilityHidden(true) }
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
