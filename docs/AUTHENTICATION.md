# Authentication

Sign-in goes through Supabase Auth: Google, Sign in with Apple (off by default) and
email one-time codes. Every method leads to the same account. SMTP is only how Supabase
sends the code, not a separate login system.

## Configuration

Frontend build values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example
NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true
NEXT_PUBLIC_AUTH_APPLE_ENABLED=false
NEXT_PUBLIC_AUTH_EMAIL_OTP_ENABLED=false
```

Server runtime values:

```dotenv
SUPABASE_URL=https://supabase.example.com
SUPABASE_PUBLIC_URL=https://supabase.example.com
SUPABASE_PUBLISHABLE_KEY=sb_publishable_example
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
```

The URL and publishable key are public; RLS protects the rows. The service-role key
bypasses RLS. It must never get a `NEXT_PUBLIC_` prefix or appear in logs, screenshots,
build arguments or git.

The iPhone app reads the same public values from the gitignored
`ios/Configuration/Local.xcconfig`. It completes PKCE in `ASWebAuthenticationSession` and
keeps the session in Keychain. Add its callback to the Supabase redirect allow list:

```text
swissdeliverytracker://auth-callback
```

On self-hosted Supabase, configure GoTrue through environment variables (site URL, allow
list, SMTP, templates). The hosted dashboard doesn't configure a self-hosted Auth server.

## Email codes

Enable the Email provider with sign-ups, set the Site URL to the production origin, and
allow only real redirect origins.

The app serves a branded template at `/auth-emails/magic-link.html`. It shows the six-digit
`{{ .Token }}` and picks its language from the `locale` user metadata the apps save
(English by default). While auto-confirm is off, new accounts get the *confirmation* email
instead of the magic-link one, so point both at the same template:

```dotenv
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=https://delivery.example.com/auth-emails/magic-link.html
GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://delivery.example.com/auth-emails/magic-link.html
GOTRUE_MAILER_SUBJECTS_MAGIC_LINK={{ if eq .Data.locale "de" }}Dein Anmeldecode für Delivery Tracker{{ else if eq .Data.locale "fr" }}Ton code de connexion Delivery Tracker{{ else if eq .Data.locale "it" }}Il tuo codice di accesso a Delivery Tracker{{ else if eq .Data.locale "es" }}Tu código de acceso a Delivery Tracker{{ else if eq .Data.locale "pt" }}O teu código de acesso ao Delivery Tracker{{ else if eq .Data.locale "pl" }}Twój kod logowania do Delivery Tracker{{ else }}Your Delivery Tracker sign-in code{{ end }}
GOTRUE_MAILER_SUBJECTS_CONFIRMATION=<same value as GOTRUE_MAILER_SUBJECTS_MAGIC_LINK>
```

Auth caches the template and keeps the last good copy if a later fetch fails. The UI calls
`signInWithOtp` then `verifyOtp` (type `email`). It never uses magic-link callbacks.

**Use your own SMTP before opening sign-ups.** Supabase's default sender only reaches team
addresses and is heavily rate-limited. Any SMTP service works. Use a dedicated sender
address, publish SPF, DKIM and DMARC, turn off link tracking, and enable CAPTCHA and Auth
email rate limits. Otherwise the OTP endpoint can be abused.

## Google

Create a **Web application** OAuth client. Add the app origin as a JavaScript origin and
the Supabase callback as the redirect URI:

```text
https://supabase.example.com/auth/v1/callback
```

Give the credentials to GoTrue only, never to the app container or the browser:

```dotenv
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=google-client-id
GOTRUE_EXTERNAL_GOOGLE_SECRET=server-only-client-secret
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://supabase.example.com/auth/v1/callback
```

Set `GOTRUE_SITE_URL` and `GOTRUE_URI_ALLOW_LIST`, restart Auth, and check that
`/auth/v1/settings` lists Google.

## Sign in with Apple

Implemented on web and iOS, off until configured. It needs a paid Apple Developer
membership, because a Personal Team can't enable the capability.

1. Enable **Sign in with Apple** on the app ID `com.plhery.SwissDeliveryTracker` (or yours).
2. Create a Services ID for the web (e.g. `com.plhery.SwissDeliveryTracker.web`). Register
   your Supabase host as its domain and `https://supabase.example.com/auth/v1/callback` as
   its return URL.
3. Create a Sign in with Apple key and keep the `.p8` outside the repo. Generate the client
   secret JWT from it. Apple caps its lifetime at six months, so renew it in time.
4. Configure GoTrue. The Services ID must come first; the bundle ID is accepted as an
   ID-token audience. Keep nonce verification on.

   ```env
   GOTRUE_EXTERNAL_APPLE_ENABLED=true
   GOTRUE_EXTERNAL_APPLE_CLIENT_ID=com.plhery.SwissDeliveryTracker.web,com.plhery.SwissDeliveryTracker
   GOTRUE_EXTERNAL_APPLE_SECRET=<server-only client secret JWT>
   GOTRUE_EXTERNAL_APPLE_REDIRECT_URI=https://supabase.example.com/auth/v1/callback
   ```

5. Register your email sender with Apple's private relay so Hide My Email addresses
   receive codes.
6. Turn the buttons on:
   - Web: build with `NEXT_PUBLIC_AUTH_APPLE_ENABLED=true`.
   - iOS: set `SDT_APPLE_AUTH_ENABLED = YES` in `Local.xcconfig`, and sign with the paid
     team and a profile that includes `com.apple.developer.applesignin`. The Personal Team
     script turns Apple sign-in off.

The web uses Supabase OAuth with PKCE. iOS uses the native sheet (email scope only) and
exchanges the identity token plus the original nonce with Supabase. Pending friend
invitations survive the redirect.

## Sessions

The client keeps the Supabase session and refreshes the short-lived access token. Sessions
don't expire by default, so users stay signed in until they sign out or delete their
account. Keep the access-token lifetime short (about an hour); refresh tokens carry the
long session. If you enable time-box or inactivity limits, use at least 30 days.

## Checklist

1. Request a code for a non-team address; the branded email arrives once.
2. Sign in, reload, reopen the installed PWA and relaunch the iPhone app.
3. A second account can't see, refresh, archive, export or get notifications for the first
   account's parcels.
4. After sign-out, private API calls return `401`.
5. Export data, then delete a disposable account. Deletion needs a sign-in from the last
   ten minutes.
6. For Apple: first and repeat sign-in, Hide My Email, cancel, sign-out, and returning to a
   pending invitation, on both platforms.

References: Supabase [email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[sessions](https://supabase.com/docs/guides/auth/sessions),
[Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple); Apple
[web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/).
