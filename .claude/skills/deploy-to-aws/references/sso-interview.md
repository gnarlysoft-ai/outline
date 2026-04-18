# SSO Interview Per Provider

Detailed per-provider prompts for step 2c of the deploy workflow. Read
the section for whichever provider the user picked and follow it to
collect the right values into `.deploy.env`. Full user-facing setup docs
with screenshots live at `docs/sso-{google,azure,oidc}.md` — direct the
user there if they haven't already registered the OAuth app.

Always write the redirect URI as **`https://<DOMAIN>/auth/<provider>.callback`**
(where `<provider>` is literally `google`, `azure`, or `oidc`). Any
mismatch — trailing slash, wrong scheme, different port — breaks sign-in
with unhelpful error messages.

## Google

1. Ask: **"Have you registered an OAuth 2.0 Web application client in
   Google Cloud Console?"** If no, walk them through it:
   - Console → APIs & Services → Credentials → **Create OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `https://<DOMAIN>/auth/google.callback`
   - Confirm an OAuth consent screen is configured (Internal works for
     Google Workspace; External needs consent review for public use)
2. Prompt for:
   - `GOOGLE_CLIENT_ID` — format looks like
     `123456789-abcdefg.apps.googleusercontent.com`. Validate that it
     ends in `.apps.googleusercontent.com`.
   - `GOOGLE_CLIENT_SECRET` — starts with `GOCSPX-`. Validate with that
     prefix.

## Azure / Entra

1. Ask: **"Have you registered an app in the Entra admin center?"** If
   no, walk them through it:
   - Entra admin center → App registrations → **New registration**
   - Redirect URI → Platform = Web, URL =
     `https://<DOMAIN>/auth/azure.callback`
   - Copy three values from the app overview:
     - Application (client) ID
     - Directory (tenant) ID
     - A client secret (Certificates & secrets → New client secret;
       copy the **Value**, not the Secret ID, immediately — it's only
       shown once)
   - API permissions → add `openid`, `profile`, `email`,
     `offline_access`, `User.Read` from Microsoft Graph delegated, then
     grant admin consent
2. Prompt for:
   - `AZURE_CLIENT_ID` — UUID format,
     `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
   - `AZURE_TENANT_ID` — UUID format (different from client ID; also a
     UUID). Common mistake: pasting the same value into both.
   - `AZURE_CLIENT_SECRET` — ~40-character string; the "Value" column,
     NOT the "Secret ID" column

Validate both UUIDs look like UUIDs (36 chars, 4 hyphens) and that
`CLIENT_ID != TENANT_ID` before accepting.

## OIDC (generic)

1. Ask: **"Do you have the OAuth client ID, client secret, and the
   three endpoint URLs (auth, token, userinfo) from your IdP?"** If no,
   walk them through what to look for:
   - Application type: Web / Regular web app (authorization code flow)
   - Redirect URI: `https://<DOMAIN>/auth/oidc.callback`
   - Scopes: `openid`, `profile`, `email`
   - Find the provider's `.well-known/openid-configuration` document
     — lists the three endpoint URLs
2. Prompt for:
   - `OIDC_CLIENT_ID`
   - `OIDC_CLIENT_SECRET`
   - `OIDC_AUTH_URI` — validate starts with `https://` and path
     typically ends in `/authorize` or `/oauth/authorize`
   - `OIDC_TOKEN_URI` — `https://` + `/token` or `/oauth/token`
   - `OIDC_USERINFO_URI` — `https://` + `/userinfo`
   - `OIDC_DISPLAY_NAME` — label on the sign-in button, e.g. "Okta",
     "Company SSO" (default `SSO`)

## Secret hygiene

- Treat all `*_CLIENT_SECRET` values carefully. Write to `.deploy.env`
  (gitignored), never echo back in summaries (mask as `***`).
- The user can paste secrets in chat — that's acceptable since the
  prompt is local to their machine. Just don't repeat them in response
  text after capture.
