# Azure / Microsoft 365 SSO Setup

Configure Microsoft Entra ID (formerly Azure AD) as the SSO provider for
your Outline deployment.

## 1. Register the application in Entra

1. Open the [Microsoft Entra admin center → Applications → App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade).
2. Click **New registration**.
3. Name: `Outline`.
4. Supported account types: choose **Single tenant** (most common) or
   **Multi-tenant** if you want users from multiple Entra tenants.
5. Redirect URI → Platform: **Web**.
6. Redirect URI → Value: `https://<your-domain>/auth/azure.callback`
   — replace `<your-domain>` with your Outline hostname.
7. Click **Register**.

## 2. Capture the three values you need

On the app's overview page:

- **Application (client) ID** → used as `AzureClientId`
- **Directory (tenant) ID** → used as `AzureTenantId`

## 3. Create a client secret

1. Navigate to the app → **Certificates & secrets → Client secrets → New client secret**.
2. Set an expiry (Entra's max is 24 months — pick shorter if your
   compliance requires).
3. Copy the **Value** immediately (Entra shows it only once). This is
   your `AzureClientSecret`.

## 4. Configure API permissions

On **API permissions → Add a permission → Microsoft Graph → Delegated permissions**:

- `openid`
- `profile`
- `email`
- `offline_access`
- `User.Read`

Then click **Grant admin consent for <tenant>** to pre-approve these for
all users. Without admin consent, every first-time user hits a consent
prompt.

## 5. Deploy with Azure SSO enabled

When deploying the CloudFormation stack (see [deploy.md](deploy.md)),
set these parameters:

- `SSOProvider` = `Azure`
- `AzureClientId` = *the Application (client) ID from step 2*
- `AzureTenantId` = *the Directory (tenant) ID from step 2*
- `AzureClientSecret` = *the client secret value from step 3* (marked
  `NoEcho` in the template — masked from the AWS Console)

Leave all `Google*` and `OIDC*` parameters blank.

## 6. First sign-in

Visit `https://<your-domain>`. You should see a **Continue with Microsoft**
button. Sign in with an account from the tenant you registered in.

The first account to sign in becomes the team admin. Additional users in
the same tenant can sign in on their own and will be added to the team
automatically.

## Rotating the client secret

Entra client secrets expire. Set a calendar reminder a week before expiry:

1. Generate a new secret in the Entra portal.
2. Update the `AzureClientSecret` CloudFormation parameter and redeploy.
3. Once the new tasks are running, delete the old secret in Entra.
