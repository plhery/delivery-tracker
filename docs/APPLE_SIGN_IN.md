# Sign in with Apple

The integration is implemented on iOS and web but disabled by default. Activation requires an Apple Developer Program membership; a free Personal Team cannot enable the capability. Google and email remain available independently.

## Apple and Supabase setup

1. Enable **Sign in with Apple** on the app identifier `com.plhery.SwissDeliveryTracker` in the Apple Developer account. Use this identifier and the paid team when signing the iOS app.
2. Create a web Services ID, for example `com.plhery.SwissDeliveryTracker.web`, associated with that app. Register `supabase-delivery.plhery.com` as its domain and `https://supabase-delivery.plhery.com/auth/v1/callback` as its return URL.
3. Create a Sign in with Apple signing key and store the `.p8` file outside the repository. Generate the Apple client-secret JWT with that key, its key ID, the developer team ID, and the Services ID. Renew this JWT before its expiry (Apple allows at most six months).
4. Configure the self-hosted Supabase Auth service through Coolify's persisted service configuration:

   ```env
   GOTRUE_EXTERNAL_APPLE_ENABLED=true
   GOTRUE_EXTERNAL_APPLE_CLIENT_ID=com.plhery.SwissDeliveryTracker.web,com.plhery.SwissDeliveryTracker
   GOTRUE_EXTERNAL_APPLE_SECRET=<server-only Apple client-secret JWT>
   GOTRUE_EXTERNAL_APPLE_REDIRECT_URI=https://supabase-delivery.plhery.com/auth/v1/callback
   ```

   The Services ID must come first for web OAuth. The native bundle ID is also accepted as an ID-token audience. Keep nonce verification enabled. Keep the existing web origin and native callback (`swissdeliverytracker://auth-callback`) in the Supabase redirect allowlist.
5. Register the app's existing email sender with Apple's private email relay so accounts using Hide My Email can receive sign-in codes.

## Enable the buttons

- Web: set the build variable `NEXT_PUBLIC_AUTH_APPLE_ENABLED=true` in Coolify and rebuild. Docker defaults it to `false`.
- iOS: set `SDT_APPLE_AUTH_ENABLED = YES` in the ignored `ios/Configuration/Local.xcconfig`, sign with the paid team and a profile containing `com.apple.developer.applesignin`, and rebuild. The Personal Team preparation script intentionally disables Apple sign-in and removes the unsupported entitlement.

No Apple private key or client secret belongs in public environment variables or the iOS bundle.

## Flow and verification

The web uses Supabase OAuth with the existing PKCE session storage and same-origin return. Pending friend invitations remain in the existing invitation store across that redirect. iOS uses Apple's native authorization sheet, requests email only, then exchanges the identity token and original nonce with Supabase. Apple receives a SHA-256 digest of a fresh cryptographically random nonce. Friends continues to use the user's chosen nickname.

Before enabling production, verify a first sign-in, repeat sign-in, Hide My Email, cancellation, sign-out, and return to a pending friend invitation on both platforms. Automated tests cover provider selection, retries, nonce exchange, persistence, and stale-session rejection; real Apple authorization requires the configured developer account.

References: [Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/) and [Supabase Apple authentication](https://supabase.com/docs/guides/auth/social-login/auth-apple).
