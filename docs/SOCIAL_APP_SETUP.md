# Create social apps and API credentials

Relay connects social accounts with OAuth. You create and own the developer applications; Relay never supplies shared platform credentials.

Provider dashboards and review forms change over time. The product names, callbacks, environment variables, and scopes below match Relay's implementation. If a dashboard label has moved, use the linked official documentation to locate the equivalent setting.

## Before you begin

Deploy Relay at its final HTTPS origin first and set `APP_URL` to that origin without a trailing slash, for example:

```dotenv
APP_URL=https://relay.example.com
```

Prepare public pages for your privacy policy and terms of service. Platform review commonly requires them, along with an app icon, support contact, data-use explanation, and a screen recording of the complete connection and publishing flow.

Credentials are server secrets. Add them to `.env` for local Docker or to Coolify's runtime environment variables, then restart or redeploy both `web` and `worker`. Never prefix these variables with `NEXT_PUBLIC_`.

## Credential and callback reference

| Relay connection | Credential variables | Callback |
| --- | --- | --- |
| Facebook Pages | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | `<APP_URL>/api/oauth/facebook/callback` |
| Instagram via Facebook | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | `<APP_URL>/api/oauth/instagram/callback` |
| Instagram Login | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | `<APP_URL>/api/oauth/instagram-standalone/callback` |
| TikTok | `TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET` | `<APP_URL>/api/oauth/tiktok/callback` |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | `<APP_URL>/api/oauth/youtube/callback` |

Callback values must match exactly. Do not add a trailing slash.

## Facebook Pages and Instagram via Facebook

These two connection methods share one Meta app and the `FACEBOOK_*` credential pair. This is also the Instagram path to use when a professional Instagram account is linked to a Facebook Page.

### Account prerequisites

- The connecting Facebook user must have sufficient control over at least one Facebook Page.
- For Instagram, use a professional Business or Creator account linked to a Facebook Page the user can manage.
- Development-mode apps generally work only for people assigned a role on the Meta app. Public use requires the appropriate access level, review, and any business verification Meta requests.

### Create and configure the Meta app

1. Open [Meta for Developers](https://developers.facebook.com/apps/) and create an app owned by the appropriate business portfolio.
2. Select a business-oriented app/use case that allows Facebook Login, Pages API access, and Instagram Graph API access. Meta changes the names of these use cases periodically.
3. Add **Facebook Login for Business** (or the current Facebook Login web product) and the Instagram API product.
4. In the Facebook Login settings, add both exact valid OAuth redirect URIs:

   ```text
   https://relay.example.com/api/oauth/facebook/callback
   https://relay.example.com/api/oauth/instagram/callback
   ```

5. Add your Relay domain to the app's allowed domains and complete the privacy-policy URL, terms URL, user-data deletion instructions or callback, icon, category, and contact details requested under app settings.
6. Copy the Meta **App ID** and **App secret** into Relay:

   ```dotenv
   FACEBOOK_APP_ID=<Meta App ID>
   FACEBOOK_APP_SECRET=<Meta App secret>
   ```

7. Add the Facebook/Instagram accounts used for development under app roles, or add testers through the business portfolio as required by the current Meta dashboard.

### Request the permissions Relay uses

Facebook Pages connection requests:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
business_management
read_insights
```

Instagram via Facebook requests:

```text
pages_show_list
pages_read_engagement
business_management
instagram_basic
instagram_content_publish
instagram_manage_insights
```

Request advanced access/app review for every permission needed by people who do not have a role on the app. In review notes, show how the user selects a Page or professional Instagram account, creates a post in Relay, publishes it, and views analytics. Ask only for the permissions listed above.

Meta's starting points are the [app dashboard](https://developers.facebook.com/apps/), [Facebook Login documentation](https://developers.facebook.com/docs/facebook-login/), and [Instagram Platform documentation](https://developers.facebook.com/docs/instagram-platform/).

### Test the connection

Redeploy Relay, sign in, open **Connected accounts**, and test Facebook and Instagram separately. If Instagram discovers no accounts, verify that the professional Instagram account is linked to the Page and that the authorizing Facebook user can manage that Page.

## Instagram Login without Facebook

Relay also supports the Instagram API with Instagram Login. It uses Instagram-issued app credentials and does not use `FACEBOOK_APP_ID`.

### Account prerequisites

- The Instagram account must be a professional Business or Creator account.
- Add development testers while the app is not live. Public connections require Meta's applicable access and review approval.

### Create and configure Instagram Login

1. In [Meta for Developers](https://developers.facebook.com/apps/), create or select an app that supports the **Instagram API with Instagram Login**.
2. Add the Instagram product and choose the API setup for Instagram Login, not the Facebook Login setup.
3. Add this exact OAuth redirect URI in the Instagram product's API setup:

   ```text
   https://relay.example.com/api/oauth/instagram-standalone/callback
   ```

4. Add the professional Instagram accounts that will test the app and have each tester accept the invitation if Meta requires it.
5. In the Instagram product's API setup, copy the **Instagram App ID** and **Instagram App Secret** into Relay:

   ```dotenv
   INSTAGRAM_APP_ID=<Instagram App ID>
   INSTAGRAM_APP_SECRET=<Instagram App Secret>
   ```

6. Configure/request the permissions Relay uses:

   ```text
   instagram_business_basic
   instagram_business_content_publish
   instagram_business_manage_insights
   ```

7. Complete access verification/app review before allowing Instagram accounts that are not assigned as app testers.

Use Meta's [Instagram API with Instagram Login documentation](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/) as the source of truth for current eligibility and review requirements.

## TikTok

Relay uses TikTok Login Kit for OAuth, Content Posting API for uploads/direct publishing, and Display API access to list videos and collect basic analytics.

### Create and configure the TikTok app

1. Create a developer account at [TikTok for Developers](https://developers.tiktok.com/) and, preferably, create or join the organization that owns the integration.
2. Go to **Manage apps**, select **Connect an app**, and complete its name, icon, category, description, website, privacy policy, and terms.
3. Add **Web** as a platform.
4. Add **Login Kit**, **Content Posting API**, and **Display API** to the app.
5. Add this exact Login Kit redirect URI:

   ```text
   https://relay.example.com/api/oauth/tiktok/callback
   ```

6. Enable/request these scopes:

   ```text
   user.info.basic
   video.publish
   video.upload
   video.list
   ```

   `video.publish` enables direct posting, `video.upload` enables draft/inbox uploads, and `video.list` lets Relay discover published videos for analytics.

7. Verify the website, privacy-policy, terms, and media URL properties TikTok requests. Relay uploads video bytes directly, but photo posts use public URLs from `R2_PUBLIC_URL`; verify that domain or URL prefix for Content Posting API use.
8. Copy **Client key** and **Client secret** from the app credentials section:

   ```dotenv
   TIKTOK_CLIENT_ID=<TikTok Client key>
   TIKTOK_CLIENT_SECRET=<TikTok Client secret>
   ```

   TikTok calls the OAuth identifier a “Client key”; Relay's variable calls it `CLIENT_ID`.

9. Use Sandbox mode for initial testing. For production, submit the app and scopes for review with a screen recording that demonstrates authorization, creator information/privacy selection, publishing, and the resulting TikTok post.

TikTok documents the current flow in [Register Your App](https://developers.tiktok.com/doc/getting-started-create-an-app), [Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started), and the [scope reference](https://developers.tiktok.com/docs/en/tiktok-api-scopes).

### TikTok review considerations

TikTok requires the user to retain control of publishing choices. Relay queries creator information and exposes the privacy/content settings returned by TikTok. Your review video should show those controls instead of demonstrating a hard-coded privacy value.

Unaudited Content Posting API clients can be restricted to private visibility. Treat Sandbox or unaudited behavior as a development constraint, not a Relay error.

## YouTube

Relay uses a Google Cloud OAuth 2.0 **Web application** client and YouTube Data API v3. An API key alone is not sufficient.

### Create the Google project and OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select the project that will own Relay's integration.
2. Go to **APIs & Services → Library** and enable **YouTube Data API v3**.
3. Open **Google Auth Platform** and complete the Branding, Audience, and Data Access sections. Supply the application home page, privacy policy, terms, support email, and authorized domain.
4. Add these scopes under Data Access:

   ```text
   https://www.googleapis.com/auth/youtube.upload
   https://www.googleapis.com/auth/youtube.readonly
   ```

5. If the audience is External and the app is still in Testing, add the Google accounts that will connect under **Test users**.
6. Go to **Clients → Create client**, choose **Web application**, and add this exact authorized redirect URI:

   ```text
   https://relay.example.com/api/oauth/youtube/callback
   ```

   For a local installation using the default URL, you may also add:

   ```text
   http://localhost:3000/api/oauth/youtube/callback
   ```

7. Copy the OAuth client ID and secret into Relay:

   ```dotenv
   YOUTUBE_CLIENT_ID=<OAuth web client ID>
   YOUTUBE_CLIENT_SECRET=<OAuth web client secret>
   ```

Google's [YouTube Data API overview](https://developers.google.com/youtube/v3/getting-started) and [OAuth for server-side web apps](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps) describe the current setup.

### Move beyond testing

Google may limit an External app in Testing to named test users, display an unverified-app warning, and issue refresh tokens with a short lifetime. Complete the Google verification/publishing requirements before relying on long-lived production connections. YouTube API Services also has a quota system; monitor the project quota and request an extension if real usage requires it.

The connecting Google account must have a YouTube channel. Relay connects the first channel returned for the authorized account; if no channel exists, connection fails.

## Restart and verify

After adding or changing credentials, recreate the local services:

```bash
docker compose up -d
docker compose logs --tail=100 web worker
```

For Coolify, save the environment variables and redeploy. Then open **Connected accounts** in Relay and connect each enabled provider.

## Common errors

### Provider is not configured

Both variables in that provider's credential pair must be present in `web` and `worker`. Redeploy after setting them.

### Redirect URI mismatch

Compare the generated callback against the provider console character by character. Common causes are `http` versus `https`, a different subdomain, a changed local port, or an extra trailing slash.

### The owner can connect, but other users cannot

The app is probably in development/testing mode, or the requested scopes have only standard/development access. Add the user as a tester for development or complete provider review for public use.

### YouTube reconnects repeatedly

Ensure the OAuth request returns offline access, the user granted both scopes, and the Google app is no longer subject to short-lived Testing refresh tokens. If Google previously authorized Relay without returning a refresh token, remove the app from the Google account's third-party connections and connect again.

### TikTok publishing is private or permission is missing

Confirm that Content Posting API review approved `video.publish` and/or `video.upload`, then reconnect the account so the new scopes are granted.

### Instagram via Facebook finds no professional account

Confirm the Instagram account is Business or Creator, is linked to a Facebook Page, and the authorizing Facebook user has adequate Page access. For a professional account that is not linked to a Page, configure the separate Instagram Login method instead.
