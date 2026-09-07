import SwiftUI
import UIKit
import UserNotifications

struct WelcomeView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var opening = false
    @State private var greeting = 0

    private var copy: ArrivalCopy { ArrivalCopy(language: localizer.language) }

    var body: some View {
        let animateGreeting = !reduceMotion && !opening
        GeometryReader { geometry in
            ZStack {
                Brand.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 0) {
                        HStack {
                            Text(localizer.text("app.title"))
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Brand.ink)
                            Spacer()
                            AuthenticationLanguageMenu()
                        }

                        Spacer(minLength: 36)

                        VStack(spacing: 10) {
                            Text(copy.welcomeTitle)
                                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                                .tracking(-1.2)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, 8)

                        Button(action: unwrap) {
                            UnwrappingParcel(open: opening ? 1 : 0)
                                .frame(width: min(300, geometry.size.width - 48), height: min(300, geometry.size.width - 48) * 31 / 30)
                                .keyframeAnimator(initialValue: ParcelGreeting(), trigger: greeting) { content, pose in
                                    content
                                        .offset(y: animateGreeting ? pose.lift : 0)
                                        .rotationEffect(.degrees(animateGreeting ? pose.angle : 0), anchor: .bottom)
                                        .scaleEffect(x: 1, y: animateGreeting ? pose.squash : 1, anchor: .bottom)
                                } keyframes: { _ in
                                    KeyframeTrack(\.lift) {
                                        CubicKeyframe(0, duration: 0.12)
                                        CubicKeyframe(-7, duration: 0.24)
                                        SpringKeyframe(0, duration: 0.46, spring: .smooth)
                                    }
                                    KeyframeTrack(\.angle) {
                                        CubicKeyframe(-2.5, duration: 0.16)
                                        CubicKeyframe(2, duration: 0.2)
                                        CubicKeyframe(-0.8, duration: 0.2)
                                        SpringKeyframe(0, duration: 0.26, spring: .smooth)
                                    }
                                    KeyframeTrack(\.squash) {
                                        CubicKeyframe(0.975, duration: 0.12)
                                        CubicKeyframe(1.02, duration: 0.24)
                                        SpringKeyframe(1, duration: 0.46, spring: .smooth)
                                    }
                                }
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(TactileButtonStyle(scale: 0.96))
                        .accessibilityLabel(copy.open)
                        .accessibilityHint(copy.openHint)
                        .accessibilityIdentifier("welcome.openParcel")
                        .disabled(opening)
                        .padding(.top, 12)

                        Button(action: unwrap) {
                            HStack(spacing: 8) {
                                Text(copy.open)
                                Image(systemName: "arrow.right")
                                    .font(.caption.weight(.bold))
                            }
                            .font(.headline)
                            .foregroundStyle(Brand.onAccent)
                            .padding(.horizontal, 24)
                            .frame(minHeight: 50)
                            .background(Brand.accent, in: Capsule())
                            .overlay(Capsule().stroke(Brand.separator.opacity(0.3), lineWidth: 1))
                        }
                        .buttonStyle(TactileButtonStyle())
                        .disabled(opening)
                        .opacity(opening ? 0 : 1)

                        Spacer(minLength: 36)

                        Button {
                            session.enterDemo()
                        } label: {
                            Text(localizer.text("welcome.demo"))
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .frame(minHeight: 44)
                        }
                        .buttonStyle(TactileButtonStyle())
                        .accessibilityHint(localizer.text("welcome.demoDescription"))
                        .disabled(opening)
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
        .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.65), trigger: opening)
        .task(id: opening || reduceMotion || scenePhase != .active) {
            guard !opening, !reduceMotion, scenePhase == .active else { return }
            do {
                try await Task.sleep(for: .milliseconds(550))
                greeting += 1
                // One quiet reminder if the box has not been opened yet.
                try await Task.sleep(for: .seconds(6))
                greeting += 1
            } catch { return }
        }
        .task(id: opening) {
            guard opening else { return }
            if !reduceMotion {
                do { try await Task.sleep(for: .milliseconds(850)) }
                catch { return }
            }
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
                session.showSignIn()
            }
        }
    }

    private func unwrap() {
        guard !opening else { return }
        withAnimation(reduceMotion ? nil : .spring(response: 0.6, dampingFraction: 0.76)) {
            opening = true
        }
    }
}

private struct ParcelGreeting {
    var lift: CGFloat = 0
    var angle: Double = 0
    var squash: CGFloat = 1
}

struct SignInView: View {
    enum Step { case methods, code }

    let configured: Bool
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var step: Step = .methods
    @State private var email = ""
    @State private var code = ""
    @State private var emailExpanded = false
    @State private var working = false
    @State private var errorMessage: String?

    private var copy: ArrivalCopy { ArrivalCopy(language: localizer.language) }

    var body: some View {
        ZStack {
            Brand.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0) {
                    HStack {
                        Button {
                            session.showWelcome()
                        } label: {
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

                    UnwrappingParcel(open: 1)
                        .frame(width: 180, height: 186)
                        .accessibilityHidden(true)

                    VStack(spacing: 8) {
                        Text(copy.signInTitle)
                            .font(.system(.title, design: .rounded, weight: .bold))
                            .tracking(-0.6)
                        Text(copy.signInSubtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)

                    if !configured {
                        configurationNotice.padding(.top, 28)
                    } else if step == .code {
                        codeForm.padding(.top, 28)
                    } else {
                        methods.padding(.top, 28)
                    }

                    Button {
                        session.enterDemo()
                    } label: {
                        Text(localizer.text("welcome.demo"))
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.secondary)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(TactileButtonStyle())
                    .accessibilityHint(localizer.text("welcome.demoDescription"))
                    .disabled(working)
                    .padding(.top, 8)

                    privacyNotice.padding(.top, 12)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
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
                Link(localizer.text("auth.readPrivacy"), destination: session.configuration.privacyURL)
                    .font(.caption.weight(.semibold))
                    .tint(Brand.ink)
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
        VStack(spacing: 12) {
            if session.configuration.googleAuthEnabled {
                Button {
                    run { try await session.signInWithGoogle() }
                } label: {
                    HStack {
                        GoogleSignInMark()
                            .frame(width: 20, height: 20)
                            .accessibilityHidden(true)
                        Spacer(minLength: 8)
                        Text(working ? localizer.text("auth.googleOpening") : localizer.text("auth.google"))
                            .font(.headline)
                        Spacer(minLength: 8)
                        if working {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "arrow.right")
                                .font(.caption.weight(.semibold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                    .frame(minHeight: 56)
                    .foregroundStyle(Brand.onAccent)
                    .background(Brand.accent, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(Brand.separator.opacity(0.35), lineWidth: 1))
                }
                .buttonStyle(TactileButtonStyle())
                .accessibilityIdentifier("auth.google")
                .disabled(working)
            }

            if session.configuration.googleAuthEnabled && emailFormVisible {
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
            && (!session.configuration.googleAuthEnabled || emailExpanded)
    }

    private var emailForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(localizer.text("auth.emailIntro"))
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
        .padding(18)
        .parcelCardSurface()
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
        .padding(20)
        .parcelCardSurface()
    }

    @ViewBuilder private var errorView: some View {
        if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
        }
    }

    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !working else { return }
        working = true
        errorMessage = nil
        Task {
            do { try await operation() }
            catch { errorMessage = localizer.errorMessage(error) }
            working = false
        }
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
private struct UnwrappingParcel: View, Animatable {
    var open: Double

    var animatableData: Double {
        get { open }
        set { open = newValue }
    }

    var body: some View {
        GeometryReader { geometry in
            let scale = geometry.size.width / 300
            ZStack {
                Ellipse()
                    .fill(.black.opacity(0.08))
                    .frame(width: 180, height: 20)
                    .blur(radius: 9)
                    .position(x: 151, y: 283)

                polygon([(55, 142), (150, 95), (245, 142), (150, 190)])
                    .fill(Color(hex: "#806345"))

                // The rear pair folds away before the front panels reveal the box.
                flap(
                    closed: [(55, 142), (150, 95), (190, 143), (95, 190)],
                    opened: [(55, 142), (150, 95), (112, 48), (17, 95)],
                    color: Color(hex: "#C4A078")
                )
                .opacity(open)
                flap(
                    closed: [(150, 95), (245, 142), (197.5, 166), (102.5, 118.5)],
                    opened: [(150, 95), (245, 142), (270, 88), (175, 41)],
                    color: Color(hex: "#D8B997")
                )

                // A small delivery card rises from inside. It has no fake data.
                VStack(alignment: .leading, spacing: 10) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Color(hex: "#587260"))
                        .frame(width: 38, height: 38)
                        .background(Color(hex: "#E7ECE4"), in: Circle())
                    Capsule().fill(Color(hex: "#DAD7CE")).frame(width: 45, height: 4)
                    Capsule().fill(Color(hex: "#E7E4DC")).frame(width: 29, height: 4)
                }
                .padding(14)
                .frame(width: 83, height: 111)
                .background(Color(hex: "#FCFAF4"), in: RoundedRectangle(cornerRadius: 7))
                .rotationEffect(.degrees(-8 + open * 3))
                .position(x: 152, y: 174 - 69 * open)
                .opacity(min(1, max(0, open * 2)))

                polygon([(55, 142), (150, 190), (150, 277), (55, 229)])
                    .fill(Color(hex: "#C9A47B"))
                polygon([(150, 190), (245, 142), (245, 229), (150, 277)])
                    .fill(Color(hex: "#B78F66"))

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
                .rotationEffect(.degrees(27))
                .position(x: 101, y: 221)

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
                    .rotationEffect(.degrees(-27))
                    .position(x: 183, y: 234)

                flap(
                    closed: [(245, 142), (150, 190), (110, 142), (205, 95)],
                    opened: [(245, 142), (150, 190), (186, 231), (281, 183)],
                    color: Color(hex: "#D1AE85")
                )
                .opacity(open)
                flap(
                    closed: [(55, 142), (150, 190), (197.5, 166), (102.5, 118.5)],
                    opened: [(55, 142), (150, 190), (121, 234), (26, 186)],
                    color: Color(hex: "#DDBD96")
                )

                // The tape tears out of sight as the flaps open.
                polygon([(96, 122), (109, 115), (204, 163), (191, 170)])
                    .fill(Color(hex: "#EBDDCA"))
                    .opacity(max(0, 1 - open * 4))
                Path { path in
                    path.move(to: CGPoint(x: 102.5, y: 118.5))
                    path.addLine(to: CGPoint(x: 197.5, y: 166))
                }
                .stroke(Color(hex: "#AF9474").opacity(max(0, 0.6 - open * 3)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
            .frame(width: 300, height: 310)
            .scaleEffect(scale, anchor: .topLeading)
        }
        .accessibilityHidden(true)
    }

    private func flap(closed: [(Double, Double)], opened: [(Double, Double)], color: Color) -> some View {
        let points = zip(closed, opened).map { from, to in
            (from.0 + (to.0 - from.0) * open, from.1 + (to.1 - from.1) * open)
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

private struct GoogleSignInMark: View {
    var body: some View {
        Text("G")
            .font(.system(size: 21, weight: .semibold))
            .foregroundStyle(Brand.onAccent)
    }
}

private struct ArrivalCopy {
    let language: AppLanguage

    var welcomeTitle: String {
        switch language {
        case .en: "Good things\nare on their way."
        case .de: "Gute Dinge\nsind unterwegs."
        case .fr: "De belles choses\nsont en route."
        case .it: "Belle cose\nsono in arrivo."
        }
    }

    var open: String {
        switch language {
        case .en: "Open your parcel"
        case .de: "Paket öffnen"
        case .fr: "Ouvrir votre colis"
        case .it: "Apri il tuo pacco"
        }
    }

    var openHint: String {
        switch language {
        case .en: "Opens the parcel and shows sign-in options."
        case .de: "Öffnet das Paket und zeigt die Anmeldeoptionen."
        case .fr: "Ouvre le colis et affiche les options de connexion."
        case .it: "Apre il pacco e mostra le opzioni di accesso."
        }
    }

    var signInTitle: String {
        switch language {
        case .en: "Your deliveries, together."
        case .de: "Deine Lieferungen, vereint."
        case .fr: "Vos livraisons, réunies."
        case .it: "Le tue consegne, insieme."
        }
    }

    var signInSubtitle: String {
        switch language {
        case .en: "Sign in to start tracking."
        case .de: "Melde dich an und verfolge deine Pakete."
        case .fr: "Connectez-vous pour suivre vos colis."
        case .it: "Accedi per seguire i tuoi pacchi."
        }
    }
}
