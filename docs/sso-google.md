# Google SSO Setup

Configure Google Workspace / consumer Google accounts as the SSO provider
for your Outline deployment.

## 1. Create the Google OAuth client

1. Open the [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
   for the project associated with your Workspace.
2. Click **Create Credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Name: `Outline` (or whatever identifies this deployment).
5. **Authorized redirect URI**: `https://<your-domain>/auth/google.callback`
   — replace `<your-domain>` with the `Domain` parameter value you used
   (or will use) when deploying the CloudFormation template.
6. Click **Create**. Copy the **Client ID** and **Client secret**.

## 2. Consent screen

If you haven't yet configured an OAuth consent screen for the project, do
so now. Set **User type** to *Internal* if you want to restrict to your
Workspace, *External* otherwise. Add `openid`, `email`, and `profile` to
the scopes.

## 3. Deploy with Google SSO enabled

When deploying the CloudFormation stack (see [deploy.md](deploy.md)),
set these parameters:

- `SSOProvider` = `Google`
- `GoogleClientId` = *the Client ID from step 1*
- `GoogleClientSecret` = *the Client secret from step 1* (marked `NoEcho`
  in the template — masked from the AWS Console)

Leave all `Azure*` and `OIDC*` parameters blank.

## 4. First sign-in

Visit `https://<your-domain>`. You should see a **Continue with Google**
button. Click it, complete Google's consent flow, and you'll land in
Outline signed in as that Google identity.

The first Google account to sign in becomes the team admin. Additional
Google users can sign in on their own (subject to your consent-screen
`User type` setting) and will be added to the team automatically.

## Rotating credentials

To rotate the client secret:

1. Generate a new secret in the Google Cloud Console.
2. Update the `GoogleClientSecret` CloudFormation parameter and redeploy
   the stack (or update the env var directly on the ECS task definition).
3. After the new tasks are running, delete the old secret in Google Cloud
   Console.
