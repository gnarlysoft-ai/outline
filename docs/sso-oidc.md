# Generic OIDC SSO Setup

Configure any OpenID Connect-compliant identity provider as the SSO
provider for your Outline deployment. This is the fallback for providers
that aren't covered by the Google or Azure plugins — for example Okta,
Auth0, Keycloak, Authentik, Zitadel, JumpCloud, or a self-hosted IdP.

## 1. Register the application with your IdP

The exact steps vary by provider, but every OIDC IdP asks for roughly the
same things:

- **Application type**: Web / Regular web app (authorization code flow)
- **Redirect URI / Callback URL**: `https://<your-domain>/auth/oidc.callback`
- **Scopes**: `openid`, `profile`, `email`
- **Grant type**: `authorization_code`

After registering, your IdP will give you:

- **Client ID**
- **Client secret**
- A **well-known** document URL, e.g. `https://<idp>/.well-known/openid-configuration` — it lists the `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`.

## 2. Look up the three endpoint URLs

Open the well-known document in a browser or via `curl` and record:

- `authorization_endpoint` → `OIDCAuthUri`
- `token_endpoint` → `OIDCTokenUri`
- `userinfo_endpoint` → `OIDCUserInfoUri`

## 3. Deploy with OIDC SSO enabled

When deploying the CloudFormation stack (see [deploy.md](deploy.md)),
set these parameters:

- `SSOProvider` = `OIDC`
- `OIDCClientId` = *client ID from step 1*
- `OIDCClientSecret` = *client secret from step 1* (`NoEcho`)
- `OIDCAuthUri` = *`authorization_endpoint` from step 2*
- `OIDCTokenUri` = *`token_endpoint` from step 2*
- `OIDCUserInfoUri` = *`userinfo_endpoint` from step 2*
- `OIDCDisplayName` = the label shown on the sign-in button, e.g. `Okta`,
  `Keycloak`, `Company SSO`. Default is `SSO`.

Leave all `Google*` and `Azure*` parameters blank.

## 4. First sign-in

Visit `https://<your-domain>`. You should see a **Continue with <OIDCDisplayName>**
button. Click it, complete your IdP's flow, and you'll land in Outline.

The first account to sign in becomes the team admin.

## Common gotchas

- **Wrong redirect URI** — Most providers reject the auth response if the
  callback URL doesn't match *exactly* (including trailing slash). Copy
  `https://<your-domain>/auth/oidc.callback` verbatim.
- **Missing scopes** — Outline needs `email` and `profile` to create
  accounts. If sign-in succeeds but Outline can't read the user's name or
  email, you're missing a scope on the provider side.
- **Clock skew** — Some IdPs sign JWTs with tight `iat`/`exp` windows. If
  you see "invalid token" errors, confirm your ECS host clocks are in
  sync (they should be — Fargate uses AWS time by default).
