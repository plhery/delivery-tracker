import SwiftUI
import AuthenticationServices
import UIKit
import UserNotifications

/// One parcel stays alive across both layouts, so opening flows into sign-in.
struct ArrivalView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var invitation: FriendInvitationStore
    @EnvironmentObject private var friendsActivity: FriendsActivityStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var opening = false
    @State private var greeting = 0
    @State private var pressed = false
    @State private var stampLanded = false
    @State private var stampImpact = false
    @StateObject private var motion = ArrivalMotion()

    private var screen: ArrivalScreen {
        if invitation.isPresenting { return invitation.opened ? .signIn : .welcome }
        if case .welcome = session.state { return .welcome }
        return .signIn
    }

    private var greetingActive: Bool {
        screen == .welcome && !opening && !reduceMotion && scenePhase == .active
    }

    var body: some View {
        let animateGreeting = !reduceMotion
        let currentTilt = reduceMotion ? ArrivalTilt() : motion.tilt
        let isPressed = pressed && !reduceMotion
        let isOpening = opening
        let reveal = opening || screen == .signIn ? 1.0 : 0.0
        ZStack {
            Brand.background.ignoresSafeArea()
            if screen == .welcome {
                WelcomeView(opening: opening, onOpen: unwrap, onSignIn: showSignIn, onPressChanged: { pressed = $0 }, invitation: invitation.isPresenting ? invitation : nil, onDismiss: dismissInvitation)
                    .transition(.opacity)
            } else {
                Group {
                    if invitation.isPresenting && session.user != nil {
                        FriendInvitationAcceptanceView(onBack: goBack)
                    } else {
                        SignInView(configured: session.configuration.authenticationConfigured, onBack: goBack, invitation: invitation.isPresenting ? invitation : nil)
                    }
                }
                    .transition(.asymmetric(
                        insertion: .opacity.animation(.easeOut(duration: reduceMotion ? 0.15 : 0.35).delay(reduceMotion ? 0 : 0.25)),
                        removal: .opacity
                    ))
            }
        }
        .overlayPreferenceValue(ArrivalParcelFrame.self) { frames in
            GeometryReader { geometry in
                if let anchor = frames[screen] {
                    let frame = geometry[anchor]
                    Color.clear
                        .keyframeAnimator(initialValue: ParcelGreeting(), trigger: greeting) { _, pose in
                            UnwrappingParcel(
                                open: reveal,
                                tilt: currentTilt,
                                lift: animateGreeting ? pose.lift : 0,
                                sway: animateGreeting ? pose.angle : 0,
                                pressed: isPressed,
                                celebrating: isOpening,
                                senderName: invitation.isPresenting ? invitation.nickname : nil
                            )
                            .animation(.easeOut(duration: isOpening ? 0.35 : 0.07), value: currentTilt)
                            .animation(.spring(response: 0.3, dampingFraction: 0.64), value: isPressed)
                        } keyframes: { _ in
                            KeyframeTrack(\.lift) {
                                CubicKeyframe(-9, duration: 2.3)
                                CubicKeyframe(0, duration: 2.3)
                            }
                            KeyframeTrack(\.angle) {
                                CubicKeyframe(1.1, duration: 2.3)
                                CubicKeyframe(-0.8, duration: 2.3)
                            }
                        }
                        .overlay {
                            if invitation.receipt != nil {
                                FriendshipReceiptStamp()
                                    .frame(width: 100, height: 116)
                                    .rotationEffect(.degrees(stampLanded ? -9 : -22))
                                    .scaleEffect(reduceMotion || stampLanded ? 1 : 1.7)
                                    .offset(x: 28, y: reduceMotion || stampLanded ? 34 : -80)
                                    .opacity(stampLanded ? 1 : 0)
                            }
                        }
                        .frame(width: 300, height: 310)
                        .scaleEffect(frame.width / 300)
                        .position(x: frame.midX, y: frame.midY)
                        .animation(reduceMotion ? nil : .spring(duration: 0.75, bounce: 0.08), value: screen)
                }
            }
            .clipped()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .onChange(of: greetingActive, initial: true) { _, active in motion.setActive(active) }
        .onDisappear { motion.setActive(false) }
        .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.45), trigger: stampImpact) { _, value in value }
        .task(id: invitation.receipt != nil && scenePhase == .active) {
            guard invitation.receipt != nil else { return }
            guard scenePhase == .active else { finishReceipt(); return }
            do {
                try await Task.sleep(for: .milliseconds(reduceMotion ? 30 : 250))
                withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.32, dampingFraction: 0.62)) { stampLanded = true }
                try await Task.sleep(for: .milliseconds(reduceMotion ? 80 : 210))
                stampImpact = true
                try await Task.sleep(for: .milliseconds(reduceMotion ? 180 : 450))
                finishReceipt()
            } catch { }
        }
        .task(id: invitation.isPresenting && scenePhase == .active) {
            guard invitation.isPresenting, scenePhase == .active else { return }
            await invitation.loadPreview(session: session)
        }
        .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.65), trigger: opening) { _, newValue in newValue }
        .sensoryFeedback(.impact(weight: .light, intensity: 0.35), trigger: screen) { old, new in
            old == .welcome && new == .signIn
        }
        .task(id: greetingActive) {
            guard greetingActive else { return }
            do {
                try await Task.sleep(for: .milliseconds(250))
                while !Task.isCancelled {
                    greeting += 1
                    try await Task.sleep(for: .seconds(4.6))
                }
            } catch { return }
        }
        .task(id: opening && screen == .welcome) {
            guard opening, screen == .welcome else { return }
            do {
                try await Task.sleep(for: .milliseconds(reduceMotion ? 150 : 980))
            } catch { return }
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: reduceMotion ? 0.15 : 0.45)) {
                if invitation.isPresenting { invitation.opened = true }
                else { session.showSignIn() }
            }
        }
    }

    private func unwrap() {
        guard !opening, screen == .welcome else { return }
        pressed = false
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.95)) {
            opening = true
        }
    }

    private func showSignIn() {
        guard !opening, !invitation.isPresenting else { return }
        pressed = false
        withAnimation(.easeInOut(duration: reduceMotion ? 0.15 : 0.45)) {
            session.showSignIn()
        }
    }

    private func goBack() {
        guard invitation.receipt == nil else { return }
        withAnimation(.easeInOut(duration: reduceMotion ? 0.15 : 0.45)) {
            opening = false
            if invitation.isPresenting { invitation.opened = false }
            else { session.showWelcome() }
        }
    }

    private func dismissInvitation() {
        invitation.dismiss()
        if !session.isAuthenticated { session.showWelcome() }
    }

    private func finishReceipt() {
        guard let receipt = invitation.receipt else { return }
        if let friend = receipt.acceptedFriend { friendsActivity.reveal(friend.id, snapshot: scenePhase == .active ? receipt.snapshot : nil) }
        invitation.finish()
    }
}

private struct FriendshipReceiptStamp: View {
    var body: some View {
        ZStack {
            PostageStampShape().fill(Brand.cream).shadow(color: .black.opacity(0.18), radius: 5, y: 3)
            VStack(spacing: 9) {
                Image(systemName: "person.2.fill").font(.system(size: 30, weight: .medium))
                Image(systemName: "checkmark.seal.fill").font(.system(size: 23))
            }
            .foregroundStyle(ExperimentalPalette.delivered)
            .padding(12)
            .overlay { RoundedRectangle(cornerRadius: 2).strokeBorder(ExperimentalPalette.delivered.opacity(0.45), style: StrokeStyle(lineWidth: 1, dash: [2, 2])).padding(9) }
        }
    }
}

private enum ArrivalScreen { case welcome, signIn }

private struct ArrivalParcelFrame: PreferenceKey {
    static var defaultValue: [ArrivalScreen: Anchor<CGRect>] { [:] }

    static func reduce(value: inout [ArrivalScreen: Anchor<CGRect>], nextValue: () -> [ArrivalScreen: Anchor<CGRect>]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private struct WelcomeView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var localizer: Localizer
    let opening: Bool
    let onOpen: () -> Void
    let onSignIn: () -> Void
    let onPressChanged: (Bool) -> Void
    var invitation: FriendInvitationStore? = nil
    var onDismiss: () -> Void = {}

    private var copy: ArrivalCopy { ArrivalCopy(localizer: localizer) }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    HStack {
                        if invitation != nil {
                            Button(action: onDismiss) { Image(systemName: "xmark").frame(width: 44, height: 44) }
                                .foregroundStyle(Brand.ink).accessibilityLabel(localizer.text("common.close"))
                        }
                        Text(localizer.text("app.title"))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Brand.ink)
                        Spacer()
                        if invitation == nil {
                            Button(copy.signInTitle, action: onSignIn)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Brand.ink)
                                .padding(.horizontal, 14)
                                .frame(minHeight: 44)
                                .background(Brand.cream, in: RoundedRectangle(cornerRadius: 12))
                                .disabled(opening)
                                .accessibilityIdentifier("welcome.signIn")
                        } else {
                            AuthenticationLanguageMenu()
                        }
                    }

                    Spacer(minLength: 36)

                    Group {
                        if let invitation { InvitationHeading(nickname: invitation.nickname) }
                        else {
                            Text(copy.welcomeTitle)
                                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                                .tracking(-1.2)
                        }
                    }
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 8)

                    if invitation == nil {
                        Text(localizer.text("arrival.welcomeSubtitle"))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 18)
                            .opacity(opening ? 0 : 1)
                    }

                    if let invitation, invitation.nickname == nil {
                        Color.clear
                            .frame(width: min(300, geometry.size.width - 48), height: min(300, geometry.size.width - 48) * 31 / 30)
                            .anchorPreference(key: ArrivalParcelFrame.self, value: .bounds) { [.welcome: $0] }
                            .accessibilityHidden(true)
                            .padding(.top, 12)
                    } else {
                        Button(action: onOpen) {
                            VStack(spacing: 8) {
                                Color.clear
                                    .frame(width: min(300, geometry.size.width - 48), height: min(300, geometry.size.width - 48) * 31 / 30)
                                    .anchorPreference(key: ArrivalParcelFrame.self, value: .bounds) { [.welcome: $0] }
                                Text(copy.tapToOpen)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                                    .frame(minHeight: 44)
                                    .opacity(opening ? 0 : 1)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(ParcelOpeningButtonStyle(onPressChanged: onPressChanged))
                        .accessibilityLabel(copy.tapToOpen)
                        .accessibilityHint(copy.openHint)
                        .accessibilityIdentifier("welcome.openParcel")
                        .disabled(opening || (invitation != nil && invitation?.nickname == nil))
                        .padding(.top, 12)
                    }

                    if let invitation {
                        if invitation.loading { ProgressView().padding(.top, 12) }
                        if let error = invitation.errorKey {
                            Text(localizer.text(error)).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            if error != "friends.inviteUnavailable" {
                                Button(localizer.text("common.retry")) { Task { await invitation.loadPreview(session: session) } }.padding(.top, 8)
                            }
                        }
                    }

                    Spacer(minLength: 64)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
                .frame(maxWidth: 520)
                .frame(minHeight: geometry.size.height)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        }
    }
}

private struct ParcelOpeningButtonStyle: ButtonStyle {
    let onPressChanged: (Bool) -> Void
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .onChange(of: configuration.isPressed) { _, pressed in onPressChanged(pressed) }
    }
}

private struct ParcelGreeting {
    var lift: CGFloat = 0
    var angle: Double = 0
}

struct SignInView: View {
    enum Step { case methods, code }

    let configured: Bool
    let onBack: () -> Void
    var invitation: FriendInvitationStore? = nil
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var step: Step = .methods
    @State private var email = ""
    @State private var code = ""
    @State private var emailExpanded = false
    @State private var working = false
    @State private var activeProvider: String?
    @State private var errorMessage: String?

    private var copy: ArrivalCopy { ArrivalCopy(localizer: localizer) }

    var body: some View {
        ZStack {
            Brand.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0) {
                    HStack {
                        Button(action: onBack) {
                            Label(localizer.text("welcome.back"), systemImage: "chevron.left")
                                .labelStyle(.iconOnly)
                                .frame(width: 42, height: 42)
                                .glassSurface(in: Circle())
                        }
                        .foregroundStyle(Brand.ink)
                        .accessibilityLabel(localizer.text("welcome.back"))
                        Spacer()
                        AuthenticationLanguageMenu()
                    }
                    .padding(.bottom, 12)

                    Color.clear
                        .frame(width: invitation == nil ? 160 : 180, height: invitation == nil ? 165 : 186)
                        .anchorPreference(key: ArrivalParcelFrame.self, value: .bounds) { [.signIn: $0] }
                        .accessibilityHidden(true)

                    Group {
                        if invitation == nil {
                            authenticationContent
                                .padding(22)
                                .background(Brand.paper, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                                .overlay { RoundedRectangle(cornerRadius: 24).strokeBorder(Brand.separator.opacity(0.35), lineWidth: 0.75) }
                                .accessibilityIdentifier("auth.card")
                        } else {
                            authenticationContent
                        }
                    }
                    .frame(maxWidth: invitation == nil ? 365 : .infinity)

                    if invitation == nil {
                        Button { session.enterDemo() } label: {
                            HStack(spacing: 7) {
                                Text(localizer.text("welcome.demo"))
                                Image(systemName: "arrow.up.right").font(.caption)
                            }
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.secondary)
                            .frame(minHeight: 44)
                        }
                        .buttonStyle(TactileButtonStyle())
                        .accessibilityIdentifier("auth.demo")
                        .accessibilityHint(localizer.text("welcome.demoDescription"))
                        .disabled(working)
                        .padding(.top, 12)
                    } else {
                        privacyNotice.padding(.top, 12)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var authenticationContent: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                if let invitation { InvitationHeading(nickname: invitation.nickname) }
                else {
                    Text(copy.signInTitle)
                        .font(.title.weight(.semibold))
                        .tracking(-0.6)
                }
                Text(invitation == nil ? copy.signInSubtitle : localizer.text("friends.signInToAccept"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, invitation == nil ? 0 : 8)

            Group {
                if let invitation, invitation.nickname == nil {
                    if let error = invitation.errorKey {
                        Text(localizer.text(error)).font(.footnote).foregroundStyle(.secondary)
                        Button(localizer.text("common.retry")) { Task { await invitation.loadPreview(session: session) } }
                    } else { ProgressView() }
                } else if !configured {
                    if invitation == nil { configurationNotice }
                    else { Text(localizer.text("auth.configTitle")).font(.subheadline).foregroundStyle(.secondary) }
                } else if step == .code {
                    codeForm
                } else {
                    methods
                }
            }
            .padding(.top, invitation == nil ? 23 : 28)

            if invitation == nil { compactPrivacyNotice.padding(.top, 18) }
        }
    }

    private var compactPrivacyNotice: some View {
        var text = AttributedString(localizer.text("auth.privacyShort") + " ")
        var link = AttributedString(localizer.text("auth.privacyLink"))
        link.link = session.configuration.privacyURL
        link.underlineStyle = .single
        text.append(link)
        return HStack(alignment: .top, spacing: 7) {
            Image(systemName: "lock").font(.caption2).padding(.top, 2)
            Text(text).font(.caption2).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(.secondary)
        .tint(Color(uiColor: .secondaryLabel))
    }

    private var privacyNotice: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 20, height: 20)
            VStack(alignment: .leading, spacing: 4) {
                Text(localizer.text("auth.privacy"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Link(destination: session.configuration.privacyURL) {
                    Text(localizer.text("auth.readPrivacy"))
                        .font(.caption)
                        .underline(color: Color(uiColor: .tertiaryLabel))
                }
                .tint(Color(uiColor: .secondaryLabel))
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 18)
        .overlay(alignment: .top) { Divider() }
    }

    private var configurationNotice: some View {
        NoticeBanner(
            symbol: "wrench.and.screwdriver.fill",
            title: localizer.text("auth.configTitle"),
            message: localizer.text("native.configurationHelp"),
            tint: .orange
        )
    }

    private var methods: some View {
        VStack(spacing: invitation == nil ? 9 : 12) {
            if session.configuration.appleAuthEnabled {
                AppleAuthenticationButton(cornerRadius: invitation == nil ? 13 : 18) {
                    run(provider: "apple") { try await session.signInWithApple() }
                }
                .id(colorScheme)
                .frame(height: invitation == nil ? 48 : 56)
                .overlay(alignment: .trailing) {
                    if activeProvider == "apple" {
                        ProgressView().tint(colorScheme == .dark ? .black : .white)
                            .padding(.trailing, 18).allowsHitTesting(false)
                    }
                }
                .accessibilityLabel(localizer.text("auth.apple"))
                .accessibilityIdentifier("auth.apple")
                .disabled(working)
            }
            if session.configuration.googleAuthEnabled {
                Button {
                    run(provider: "google") { try await session.signInWithGoogle() }
                } label: {
                    HStack(spacing: 10) {
                        GoogleSignInMark()
                            .frame(width: 20, height: 20)
                            .accessibilityHidden(true)
                        Text(activeProvider == "google" ? localizer.text("auth.googleOpening") : localizer.text("auth.google"))
                            .font(.subheadline.weight(.medium))
                        if activeProvider == "google" { ProgressView().controlSize(.small) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(minHeight: 48)
                    .foregroundStyle(Brand.ink)
                    .background(Brand.paper, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 13).stroke(Brand.separator.opacity(0.35), lineWidth: 0.75))
                }
                .buttonStyle(TactileButtonStyle())
                .accessibilityIdentifier("auth.google")
                .disabled(working)
            }

            if socialSignInEnabled && emailFormVisible {
                HStack {
                    Rectangle().frame(height: 0.5)
                    Text(localizer.text("auth.or")).font(.caption).foregroundStyle(.secondary)
                    Rectangle().frame(height: 0.5)
                }
                .foregroundStyle(.secondary.opacity(0.35))
            }

            if emailFormVisible {
                emailForm
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            } else if session.configuration.emailOTPEnabled {
                Button {
                    errorMessage = nil
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
                        emailExpanded = true
                    }
                } label: {
                    Label(localizer.text("auth.emailOption"), systemImage: "envelope")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 48)
                        .background(invitation == nil ? Brand.cream : Color.clear, in: RoundedRectangle(cornerRadius: 13))
                }
                .buttonStyle(TactileButtonStyle())
                .foregroundStyle(Brand.ink)
                .disabled(working)
            }
            if !emailFormVisible {
                errorView
            }
        }
    }

    private var emailFormVisible: Bool {
        session.configuration.emailOTPEnabled
            && (!socialSignInEnabled || emailExpanded)
    }

    private var socialSignInEnabled: Bool {
        session.configuration.googleAuthEnabled || session.configuration.appleAuthEnabled
    }

    private var emailForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(localizer.text(invitation == nil ? "auth.emailIntroShort" : "auth.emailIntro"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            TextField(localizer.text("auth.email"), text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 15)
                .frame(height: 52)
                .background(.background, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 15).stroke(.separator.opacity(0.7)))
            errorView
            Button {
                run {
                    try await session.sendCode(to: email.cleanedEmail)
                    step = .code
                }
            } label: {
                HStack {
                    if working { ProgressView().tint(Brand.ink) }
                    Text(working ? localizer.text("auth.sending") : localizer.text("auth.send"))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 16))
            .tint(Brand.accent)
            .foregroundStyle(Brand.onAccent)
            .disabled(working || !email.cleanedEmail.contains("@"))
        }
        .modifier(SignInFormSurface(embedded: invitation == nil, padding: 18))
    }

    private var codeForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(localizer.text("auth.codeIntro", ["email": email.cleanedEmail]))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            TextField(localizer.text("auth.code"), text: $code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .font(.title2.weight(.semibold).monospacedDigit())
                .multilineTextAlignment(.center)
                .onChange(of: code) { _, value in
                    code = String(value.filter(\.isNumber).prefix(6))
                }
                .padding(.horizontal, 15)
                .frame(height: 58)
                .background(.background, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 15).stroke(.separator.opacity(0.7)))
            errorView
            Button {
                run { try await session.verifyCode(email: email.cleanedEmail, code: code) }
            } label: {
                HStack {
                    if working { ProgressView().tint(Brand.ink) }
                    Text(working ? localizer.text("auth.signingIn") : localizer.text("auth.openBox"))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 16))
            .tint(Brand.accent)
            .foregroundStyle(Brand.onAccent)
            .disabled(working || code.count != 6)

            Button(localizer.text("auth.differentEmail")) {
                step = .methods
                code = ""
                errorMessage = nil
            }
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .disabled(working)
        }
        .modifier(SignInFormSurface(embedded: invitation == nil, padding: 20))
    }

    @ViewBuilder private var errorView: some View {
        if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
        }
    }

    private func run(provider: String? = nil, _ operation: @escaping @MainActor () async throws -> Void) {
        guard !working else { return }
        working = true
        activeProvider = provider
        errorMessage = nil
        Task {
            do { try await operation() }
            catch AuthenticationError.oauthCancelled { }
            catch is CancellationError { }
            catch { errorMessage = localizer.errorMessage(error) }
            working = false
            activeProvider = nil
        }
    }
}

private struct SignInFormSurface: ViewModifier {
    let embedded: Bool
    let padding: CGFloat

    @ViewBuilder func body(content: Content) -> some View {
        if embedded { content }
        else { content.padding(padding).parcelCardSurface() }
    }
}

private struct AppleAuthenticationButton: UIViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    var cornerRadius: CGFloat = 18
    let action: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .continue, style: colorScheme == .dark ? .white : .black)
        button.cornerRadius = cornerRadius
        button.addTarget(context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
        return button
    }

    func updateUIView(_ button: ASAuthorizationAppleIDButton, context: Context) {
        button.isEnabled = isEnabled
        button.cornerRadius = cornerRadius
        context.coordinator.action = action
    }

    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func tapped() { action() }
    }
}

private struct InvitationHeading: View {
    let nickname: String?
    @EnvironmentObject private var localizer: Localizer

    private var sentence: AttributedString {
        guard let nickname else { return AttributedString(localizer.text("friends.invitationGeneric")) }
        let template = localizer.text("friends.invitationTitle")
        guard let slot = template.range(of: "{{name}}") else { return AttributedString(template) }
        var text = AttributedString(String(template[..<slot.lowerBound]))
        var name = AttributedString(nickname)
        name.font = .system(.title, design: .serif, weight: .semibold).italic()
        text.append(name)
        text.append(AttributedString(String(template[slot.upperBound...])))
        return text
    }

    var body: some View {
        Text(sentence)
            .font(.system(.title, design: .rounded, weight: .medium))
            .tracking(-0.6)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct FriendInvitationAcceptanceView: View {
    let onBack: () -> Void
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var parcels: ParcelStore
    @EnvironmentObject private var invitation: FriendInvitationStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = FriendsStore()
    @State private var creatingProfile = false
    @State private var editingProfile = false
    @State private var joining = false
    @State private var checkingInvitation = true
    @State private var invitationState: FriendsActionResponseInvitationState?
    private var outcomeMessage: String? {
        switch invitationState {
        case .alreadyAccepted: "friends.inviteAlreadyAccepted"
        case .alreadyFriends: "friends.alreadyFriends"
        case nil: model.errorKey == "friends.selfInvitation" ? "friends.selfInvitation" : nil
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                HStack {
                    Button(action: onBack) { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                        .foregroundStyle(Brand.ink).accessibilityLabel(localizer.text("welcome.back")).disabled(joining)
                    Spacer()
                    AuthenticationLanguageMenu()
                }
                if invitation.receipt != nil {
                    Color.clear.frame(width: 180, height: 186).anchorPreference(key: ArrivalParcelFrame.self, value: .bounds) { [.signIn: $0] }.accessibilityHidden(true)
                }
                if invitation.receipt != nil {
                    Text(localizer.text("friends.friendshipDelivered"))
                        .font(.system(.title, design: .rounded, weight: .medium)).multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                } else if let outcomeMessage {
                    Text(localizer.text(outcomeMessage))
                        .font(.system(.title, design: .rounded, weight: .medium)).multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                } else if let name = invitation.nickname { FriendPostcardView(nickname: name) }
                if let error = invitation.errorKey ?? model.errorKey, !creatingProfile, outcomeMessage == nil, invitation.receipt == nil {
                    Text(localizer.text(error)).font(.footnote).foregroundStyle(.secondary)
                    if error != "friends.inviteUnavailable" {
                        Button(localizer.text("common.retry")) { Task { await invitation.loadPreview(session: session); await checkInvitation() } }
                    }
                }
                if outcomeMessage == nil, invitation.receipt == nil, let profile = model.snapshot?.profile {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack { Text(localizer.text("friends.yourSharing")).font(.subheadline.weight(.semibold)); Spacer(); Button(localizer.text("friends.editSharing")) { editingProfile = true; creatingProfile = true; model.errorKey = nil }.font(.caption).disabled(joining) }
                        FriendSharingPreviewView(friend: model.snapshot?.ownCard ?? FriendsStore.ownCard(parcels: parcels.parcels, profile: profile))
                        Label(localizer.text("friends.privacy"), systemImage: "lock").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if outcomeMessage != nil {
                    Button { invitation.dismiss() } label: {
                        Text(localizer.text("common.close")).frame(maxWidth: .infinity, minHeight: 46)
                    }
                        .buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
                } else if !checkingInvitation, invitation.receipt == nil, invitation.nickname != nil, model.snapshot != nil {
                    Button {
                        if model.snapshot?.profile == nil { model.errorKey = nil; editingProfile = false; creatingProfile = true }
                        else { Task { await accept() } }
                    } label: {
                        HStack {
                            if joining { ProgressView().tint(Brand.onAccent) }
                            Text(localizer.text(model.snapshot?.profile == nil ? "friends.enableToAccept" : "friends.accept"))
                        }.frame(maxWidth: .infinity, minHeight: 46)
                    }.buttonStyle(.borderedProminent).tint(Brand.accent).foregroundStyle(Brand.onAccent)
                        .disabled(joining || model.errorKey == "friends.inviteUnavailable")
                } else if invitation.receipt == nil && invitation.errorKey == nil && model.errorKey == nil { ProgressView() }
            }.padding(24).frame(maxWidth: 520).frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $creatingProfile) {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let error = model.errorKey {
                            Text(localizer.text(error)).font(.footnote).foregroundStyle(.secondary)
                        }
                        FriendsProfileForm(profile: editingProfile ? model.snapshot?.profile : nil, busy: joining, submitKey: editingProfile ? "friends.save" : "friends.joinAndAccept") { profile in
                            Task { if editingProfile { await saveSharing(profile) } else { await accept(profile: profile) } }
                        }
                    }.padding(24).frame(maxWidth: 520).frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
                .background(Brand.background)
                .navigationTitle(localizer.text(editingProfile ? "friends.settings" : "friends.enable")).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(localizer.text("common.close")) { creatingProfile = false; model.errorKey = nil }
                            .foregroundStyle(Brand.ink).disabled(joining)
                    }
                }
            }
            .presentationDragIndicator(.visible).interactiveDismissDisabled(joining)
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { model.clear(); return }
            model.configure(session: session); await checkInvitation()
        }
        .onDisappear { model.clear() }
    }

    private func saveSharing(_ profile: FriendProfile) async {
        guard !joining else { return }
        joining = true
        defer { joining = false }
        if await model.act(FriendsActionRequest(action: .saveProfile, nickname: profile.nickname, shareStats: profile.shareStats, shareArrival: profile.shareArrival), parcels: parcels.parcels) != nil { creatingProfile = false }
    }

    private func checkInvitation() async {
        checkingInvitation = true
        invitationState = nil
        defer { checkingInvitation = false }
        await model.load(parcels: parcels.parcels)
        guard !Task.isCancelled, model.snapshot != nil, let code = invitation.code else { return }
        let preview = await model.act(FriendsActionRequest(action: .previewInvite, code: code), parcels: parcels.parcels)
        invitationState = preview?.invitationState
    }

    private func accept(profile: FriendProfile? = nil) async {
        guard !joining, let code = invitation.code else { return }
        joining = true
        defer {
            joining = false
            // Once enabled, a failed invitation can be retried without creating the profile again.
            if model.snapshot?.profile != nil { creatingProfile = false }
        }
        if let profile {
            guard let saved = await model.act(FriendsActionRequest(action: .saveProfile, nickname: profile.nickname, shareStats: profile.shareStats, shareArrival: profile.shareArrival), parcels: parcels.parcels) else { return }
            guard saved.snapshot?.profile != nil else { model.errorKey = "friends.actionFailed"; return }
        }
        _ = await model.act(FriendsActionRequest(action: .acceptInvite, code: code), parcels: parcels.parcels, onCommitted: { result in
            if invitation.isPresenting, invitation.code == code {
                creatingProfile = false
                if let state = result.invitationState { invitationState = state }
                else { invitation.receive(result) }
            }
        })
    }
}

struct NotificationOnboardingView: View {
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.scenePhase) private var scenePhase
    let onComplete: () -> Void

    @State private var working = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            Brand.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0) {
                    Text(localizer.text("onboarding.notifications.eyebrow"))
                        .font(.caption.weight(.bold))
                        .textCase(.uppercase)
                        .tracking(1.2)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    notificationGlyph
                        .padding(.top, 24)

                    Text(localizer.text(store.notificationsEnabledOnDevice
                        ? "onboarding.notifications.enabledTitle"
                        : "onboarding.notifications.title"))
                        .font(.system(.title, design: .rounded, weight: .bold))
                        .multilineTextAlignment(.center)
                        .padding(.top, 22)

                    Text(localizer.text(store.notificationsEnabledOnDevice
                        ? "onboarding.notifications.enabledSubtitle"
                        : "onboarding.notifications.subtitle"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 10)
                        .padding(.horizontal, 8)

                    VStack(spacing: 13) {
                        feature("sun.max.fill", "onboarding.notifications.feature.delivery", tint: ExperimentalPalette.ochre)
                        feature("shippingbox.fill", "onboarding.notifications.feature.pickup", tint: ExperimentalPalette.delivered)
                        feature("exclamationmark.triangle.fill", "onboarding.notifications.feature.issues", tint: ExperimentalPalette.rose)
                    }
                    .padding(18)
                    .parcelCardSurface()
                    .padding(.top, 24)

                    Text(localizer.text("onboarding.notifications.fineTune"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 18)

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                            .padding(.top, 16)
                    }

                }
                .padding(.horizontal, 24)
                .padding(.vertical, 22)
                .padding(.bottom, 14)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { actionTray }
        }
        .task { await store.refreshNotificationState() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await store.refreshNotificationState() }
        }
    }

    private var notificationGlyph: some View {
        ZStack {
            Circle()
                .fill(ExperimentalPalette.transit.opacity(0.10))
                .frame(width: 110, height: 110)
            Circle()
                .stroke(ExperimentalPalette.transit.opacity(0.16), lineWidth: 1)
                .frame(width: 86, height: 86)
            Image(systemName: store.notificationsEnabledOnDevice ? "bell.badge.fill" : "bell.and.waves.left.and.right.fill")
                .font(.system(size: 38, weight: .semibold))
                .symbolRenderingMode(.palette)
                .foregroundStyle(ExperimentalPalette.transit, ExperimentalPalette.ochre)
        }
        .accessibilityHidden(true)
    }

    private var actionTray: some View {
        VStack(spacing: 9) {
            primaryButton
            if !store.notificationsEnabledOnDevice {
                Button(localizer.text("onboarding.notifications.notNow")) {
                    store.deferNotificationOnboarding()
                    onComplete()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(minHeight: 34)
                .disabled(working)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 6)
        .background(.regularMaterial)
        .overlay(alignment: .top) { Divider().opacity(0.45) }
    }

    private func feature(_ symbol: String, _ key: String, tint: Color) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 40, height: 40)
                .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
            Text(localizer.text(key))
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private var primaryButton: some View {
        if store.notificationsEnabledOnDevice {
            Button(action: onComplete) {
                Label(localizer.text("onboarding.notifications.continue"), systemImage: "checkmark")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 17))
            .tint(Brand.accent)
            .foregroundStyle(Brand.onAccent)
        } else if store.notificationStatus == .denied {
            Button {
                UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
            } label: {
                Label(localizer.text("native.openSettings"), systemImage: "gear")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 17))
            .tint(Brand.ink)
        } else {
            Button(action: enableNotifications) {
                HStack(spacing: 9) {
                    if working { ProgressView().tint(Brand.ink) }
                    Image(systemName: working ? "bell" : "bell.badge.fill")
                    Text(localizer.text(working
                        ? "onboarding.notifications.enabling"
                        : "onboarding.notifications.enable"))
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 17))
            .tint(Brand.accent)
            .foregroundStyle(Brand.onAccent)
            .disabled(working)
        }
    }

    private func enableNotifications() {
        guard !working else { return }
        working = true
        errorMessage = nil
        Task {
            do {
                _ = try await store.enableNotifications(language: localizer.language)
                onComplete()
            } catch {
                await store.refreshNotificationState()
                if store.notificationStatus == .denied {
                    errorMessage = localizer.text("native.notificationsDenied")
                } else if store.notificationStatus == .authorized || store.notificationStatus == .provisional {
                    errorMessage = localizer.text("onboarding.notifications.connectionError")
                } else {
                    errorMessage = localizer.errorMessage(error)
                }
            }
            working = false
        }
    }
}

private extension String {
    var cleanedEmail: String {
        trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

private struct AuthenticationLanguageMenu: View {
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        Menu {
            Picker(localizer.text("language.label"), selection: $localizer.language) {
                ForEach(AppLanguage.allCases) { language in
                    Text(language.nativeName).tag(language)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "globe")
                Text(localizer.language.rawValue.uppercased())
                    .font(.caption.weight(.semibold))
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .tint(Brand.ink)
        .accessibilityLabel(localizer.text("language.label"))
        .accessibilityValue(localizer.language.nativeName)
    }
}

/// A little paper object, drawn in points so its folds stay crisp at every size.
/// The welcome screen gives it a small greeting; a tap unfolds the paper.
struct UnwrappingParcel: View, Animatable {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var open: Double
    var tilt = ArrivalTilt()
    var lift: CGFloat = 0
    var sway: Double = 0
    var pressed = false
    var celebrating = false
    var senderName: String? = nil
    @EnvironmentObject private var localizer: Localizer

    var animatableData: Double {
        get { open }
        set { open = newValue }
    }

    var body: some View {
        GeometryReader { geometry in
            let scale = geometry.size.width / 300
            let card = phase(0.24, 0.76)
            let breath = reduceMotion ? 0 : sin(open * .pi)
            let anticipation = reduceMotion ? 0 : max(0, 1 - abs(open - 0.12) / 0.12)
            ZStack {
                Ellipse()
                    .fill(.black.opacity(pressed ? 0.14 : 0.08 + Double(lift) * 0.004))
                    .frame(width: pressed ? 188 : 180 + lift * 3, height: pressed ? 13 : 20)
                    .blur(radius: 9)
                    .position(x: 151 - tilt.x * 7, y: 286 - tilt.y * 3)

                ZStack {
                    polygon([(55, 142), (150, 95), (245, 142), (150, 190)])
                        .fill(Color(hex: "#806345"))

                    // The rear pair folds away before the front panels reveal the box.
                    flap(
                        closed: [(55, 142), (150, 95), (190, 143), (95, 190)],
                        opened: [(55, 142), (150, 95), (112, 48), (17, 95)],
                        color: Color(hex: "#C4A078"), progress: phase(0.06, 0.66)
                    )
                    .opacity(open)
                    flap(
                        closed: [(150, 95), (245, 142), (197.5, 166), (102.5, 118.5)],
                        opened: [(150, 95), (245, 142), (270, 88), (175, 41)],
                        color: Color(hex: "#D8B997"), progress: phase(0.06, 0.66)
                    )

                    Ellipse()
                        .fill(Color(hex: "#FFE8AE").opacity(breath * 0.48))
                        .frame(width: 124, height: 40)
                        .blur(radius: 10)
                        .position(x: 150, y: 140)

                    // A small delivery card rises from inside. It has no fake data.
                    VStack(alignment: .leading, spacing: 8) {
                        if let senderName {
                            Text(String(senderName.prefix(1))).font(.system(size: 13, weight: .medium)).frame(width: 21, height: 26).background(Color(hex: "#D1BEDF"), in: PostageStampShape()).frame(maxWidth: .infinity, alignment: .trailing)
                            Text(localizer.text("friends.from")).font(.system(size: 8))
                            Text(senderName).font(.system(size: 17, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.45)
                            Capsule().fill(Color(hex: "#B39BC7")).frame(width: 29, height: 1)
                        } else {
                        Path { path in
                            path.move(to: CGPoint(x: 10, y: 19))
                            path.addLine(to: CGPoint(x: 16, y: 25))
                            path.addLine(to: CGPoint(x: 28, y: 12))
                        }
                            .trim(from: 0, to: phase(0.48, 0.3))
                            .stroke(Color(hex: "#587260"), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                            .frame(width: 38, height: 38)
                            .background(Color(hex: "#E7ECE4"), in: Circle())
                        Capsule().fill(Color(hex: "#DAD7CE")).frame(width: 45, height: 4)
                        Capsule().fill(Color(hex: "#E7E4DC")).frame(width: 29, height: 4)
                        }
                    }.foregroundStyle(Color(hex: "#69517F"))
                    .padding(14)
                    .frame(width: 83, height: 111)
                    .background(Color(hex: senderName == nil ? "#FCFAF4" : "#E7DCF4"), in: RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(.white.opacity(0.6), lineWidth: 0.8))
                    .rotationEffect(.degrees(-11 + card * 6))
                    .position(x: 152 + tilt.x * 2, y: 174 - 69 * card)
                    .opacity(min(1, card * 3))

                    polygon([(55, 142), (150, 190), (150, 277), (55, 229)])
                        .fill(LinearGradient(colors: [Color(hex: "#DDBC95"), Color(hex: "#C49A6E")], startPoint: .topLeading, endPoint: .bottomTrailing))
                    polygon([(150, 190), (245, 142), (245, 229), (150, 277)])
                        .fill(LinearGradient(colors: [Color(hex: "#BB946A"), Color(hex: "#A77E55")], startPoint: .topLeading, endPoint: .bottomTrailing))

                    polygon([(55, 142), (150, 190), (150, 277), (55, 229)])
                        .fill(Color(hex: "#FFF4D6").opacity(0.025 + (tilt.x + 1) * 0.045))
                    Path { path in
                        path.move(to: CGPoint(x: 55, y: 142))
                        path.addLine(to: CGPoint(x: 150, y: 190))
                        path.addLine(to: CGPoint(x: 245, y: 142))
                        path.move(to: CGPoint(x: 150, y: 190))
                        path.addLine(to: CGPoint(x: 150, y: 277))
                    }
                    .stroke(Color(hex: "#FFF2CF").opacity(0.22 + (tilt.x + 1) * 0.18), lineWidth: 1)

                    // The quiet shipping label is part of the illustration.
                    HStack(alignment: .bottom, spacing: 2) {
                        ForEach(0..<10) { index in
                            Rectangle()
                                .fill(Color(hex: "#4E677A"))
                                .frame(width: index.isMultiple(of: 3) ? 2 : 1, height: 17)
                        }
                    }
                    .frame(width: 51, height: 32)
                    .background(Color(hex: "#D8E5EA"), in: RoundedRectangle(cornerRadius: 3))
                    .projectionEffect(ProjectionTransform(CGAffineTransform(a: 1, b: 48.0 / 95.0, c: 0, d: 1, tx: 0, ty: 0)))
                    .position(x: 101, y: 209)

                    Image(systemName: "arrow.up")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Color(hex: "#735C43"))
                        .rotationEffect(.degrees(-27))
                        .position(x: 218, y: 214)

                    Image(systemName: "asterisk")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color(hex: "#7C6787"))
                        .frame(width: 28, height: 28)
                        .background(Color(hex: "#DECCE2"), in: Circle())
                        .overlay(Circle().inset(by: 2.5).stroke(Color(hex: "#FFF6FF").opacity(0.2 + (tilt.y + 1) * 0.28), lineWidth: 1.2))
                        .rotationEffect(.degrees(-27))
                        .position(x: 183, y: 234)

                    flap(
                        closed: [(245, 142), (150, 190), (110, 142), (205, 95)],
                        opened: [(245, 142), (150, 190), (186, 231), (281, 183)],
                        color: Color(hex: "#D1AE85"), progress: phase(0.2, 0.8)
                    )
                    .opacity(open)
                    flap(
                        closed: [(55, 142), (150, 190), (197.5, 166), (102.5, 118.5)],
                        opened: [(55, 142), (150, 190), (121, 234), (26, 186)],
                        color: Color(hex: "#DDBD96"), progress: phase(0.2, 0.8)
                    )

                    // The tape tears out of sight as the flaps open.
                    polygon([(96, 122), (109, 115), (204, 163), (191, 170)])
                        .fill(Color(hex: "#EBDDCA"))
                        .opacity(max(0, 1 - open * 4))
                        .offset(x: -6 * phase(0, 0.3), y: -19 * phase(0, 0.3))
                        .rotationEffect(.degrees(-8 * phase(0, 0.3)))
                    Path { path in
                        path.move(to: CGPoint(x: 102.5, y: 118.5))
                        path.addLine(to: CGPoint(x: 197.5, y: 166))
                    }
                    .stroke(Color(hex: "#AF9474").opacity(max(0, 0.6 - open * 3)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    ParcelStarBurst(active: celebrating)
                }
                .frame(width: 300, height: 310)
                .rotation3DEffect(.degrees(tilt.y * -6), axis: (x: 1, y: 0, z: 0), perspective: 0.35)
                .rotation3DEffect(.degrees(tilt.x * 7), axis: (x: 0, y: 1, z: 0), perspective: 0.35)
                .rotationEffect(.degrees(sway * (1 - open)))
                .scaleEffect(pressed ? 0.956 : 1 - anticipation * 0.032 + breath * 0.025, anchor: .bottom)
                .offset(x: tilt.x * 11, y: Double(lift) * (1 - open) + tilt.y * 6 + (pressed ? 5 : anticipation * 4 - breath * 8))
            }
            .frame(width: 300, height: 310)
            .scaleEffect(scale, anchor: .topLeading)
        }
        .accessibilityHidden(true)
    }

    private func phase(_ start: Double, _ duration: Double) -> Double {
        min(1, max(0, (open - start) / duration))
    }

    private func flap(closed: [(Double, Double)], opened: [(Double, Double)], color: Color, progress: Double) -> some View {
        let points = zip(closed, opened).map { from, to in
            (from.0 + (to.0 - from.0) * progress, from.1 + (to.1 - from.1) * progress)
        }
        return polygon(points)
            .fill(color)
            .overlay(polygon(points).stroke(Color(hex: "#987450").opacity(0.24), lineWidth: 0.7))
    }

    private func polygon(_ points: [(Double, Double)]) -> Path {
        Path { path in
            guard let first = points.first else { return }
            path.move(to: CGPoint(x: first.0, y: first.1))
            for point in points.dropFirst() {
                path.addLine(to: CGPoint(x: point.0, y: point.1))
            }
            path.closeSubpath()
        }
    }
}

/// Its own clock lets the stars linger while the same parcel moves into sign-in.
private struct ParcelStarBurst: View {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var progress = 0.0

    var body: some View {
        ParcelStars(progress: reduceMotion ? 1 : progress)
            .onChange(of: active, initial: true) { _, active in
                withAnimation(nil) { progress = 0 }
                guard active, !reduceMotion, scenePhase == .active else { return }
                withAnimation(.linear(duration: 1.85)) { progress = 1 }
            }
            .onChange(of: reduceMotion) { _, reduce in
                if reduce { withAnimation(nil) { progress = 0 } }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { withAnimation(nil) { progress = 0 } }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

private struct ParcelStars: View, Animatable {
    var progress: Double
    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }
    private let stars: [(x: Double, y: Double, size: Double, color: String)] = [
        (43, 96, 23, "#C99B35"), (91, 57, 16, "#D6AE48"),
        (151, 36, 24, "#C99B35"), (216, 55, 18, "#B594BE"),
        (261, 96, 25, "#D6AE48"), (233, 145, 13, "#C99B35"),
    ]

    var body: some View {
        ZStack {
            ForEach(stars.indices, id: \.self) { index in
                let star = stars[index]
                let delay = 0.14 + Double(index % 3) * 0.03
                let p = min(1, max(0, (progress - delay) / (1 - delay)))
                let travel = 1 - pow(1 - p, 3)
                let opacity = min(1, p / 0.16) * min(1, (1 - p) / 0.32)
                let sizeScale = (0.3 + 0.7 * min(1, p / 0.2)) * (1 + 0.16 * sin(p * Double.pi))
                let x = 150 + (star.x - 150) * (0.45 + 0.55 * travel)
                let y = 140 + (star.y - 140) * (0.3 + 0.7 * travel) - p * 12
                Image(systemName: "sparkle")
                    .font(.system(size: CGFloat(star.size), weight: .medium))
                    .foregroundStyle(Color(hex: star.color))
                    .scaleEffect(CGFloat(sizeScale))
                    .rotationEffect(.degrees(-18 + 36 * travel))
                    .opacity(opacity)
                    .position(x: CGFloat(x), y: CGFloat(y))
            }
        }
        .frame(width: 300, height: 310)
    }
}

private struct GoogleSignInMark: View {
    var body: some View {
        Text("G")
            .font(.system(size: 21, weight: .semibold))
            .foregroundStyle(Color(red: 0.259, green: 0.522, blue: 0.957))
    }
}

@MainActor
private struct ArrivalCopy {
    let localizer: Localizer

    var welcomeTitle: String { localizer.text("arrival.welcomeTitle") }
    var tapToOpen: String { localizer.text("arrival.tapToOpen") }
    var openHint: String { localizer.text("arrival.openHint") }
    var signInTitle: String { localizer.text("arrival.signInTitle") }
    var signInSubtitle: String { localizer.text("arrival.signInSubtitle") }
}
