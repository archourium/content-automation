# Connect Instagram to Content Automation

Content Automation publishes photos through the Instagram API. It supports Instagram Login and Unified Login. Set up the Meta app and authorize the Instagram account first, then run a manual publication before enabling a schedule.

## 1. Choose the owner and posting account

- Use an existing Meta developer account to manage the integration. One developer account can administer multiple Meta apps, and one Meta app for this use case can have multiple Instagram testers. A team can use an existing company mailbox as the contact address where Meta allows it. The contact email receives notices about the app.
- Each account you want to post to must be an Instagram **Professional** account (Business or Creator). Use the existing brand account and its exact `@username`. An Instagram Tester signs in on Instagram and accepts an invitation there. This role does not require the brand to have its own Meta developer account, email address, or phone number for the integration.
- Use an account-specific access token, account ID, and brand profile for each publishing destination. Meta documents Standard Access for professional accounts you own or manage and add to your app. Serving accounts you do not own or manage can require Advanced Access and App Review. [Meta access levels](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login#requirements)

## 2. Configure the Meta app

1. Sign in to [Meta for Developers → My Apps](https://developers.facebook.com/apps/) with the Meta identity that should administer the app. A browser profile and its Google email do not determine which Meta identity is signed in. Open an existing app if it already has the right Instagram use case.
2. If you need an app, choose **Create App**, enter a name, and check the contact email. Under **Use cases**, choose **Manage messaging & content on Instagram**. It may appear under **Content management**. Follow the business and requirements screens and review the terms shown on the creation screen. Meta may ask the app administrator to re-enter their Facebook password before completing app creation. If the wizard offers to connect a Business Portfolio later, you can use that option for initial testing. Meta may require a portfolio and business verification for broader access or publication of the app.
3. From **Dashboard**, select **Customize the Manage messaging & content on Instagram use case**. Open **API setup with Instagram login** or **API setup with Instagram business login** if available. If the app only offers **API setup with Unified login**, use that option. Unified Login requires a Business Portfolio before the test-token controls appear. Connect an existing portfolio where possible, or create one using the same Meta administrator and business email. [Meta Unified Login setup](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started)
4. In **Permissions and features**, confirm that the app can request `instagram_business_basic` and `instagram_business_content_publish` under Standard Access for the account you are testing with Instagram Login. For Unified Login, use the publishing permissions listed for that flow, including `instagram_basic` and `instagram_content_publish`. Review the permissions shown when authorizing the account and grant the access needed for photo publishing. [Meta content publishing requirements](https://developers.facebook.com/documentation/instagram-platform/content-publishing#requirements)

For a publishing-only Unified Login configuration, first add the two publishing permissions under **Use cases → Permissions and features**. Then open **Facebook Login for Business → Configurations → Create configuration**. Choose **General**, a **System-user access token**, and **Instagram accounts** as the required asset. Select only **instagram_basic** and **instagram_content_publish**. Choose the token expiration according to your deployment needs. Save the configuration and check that it is marked **Instagram Login Compatible** in the Unified Login setup.

## 3. Invite and verify the Instagram Tester

1. In the Meta app, open **App roles → Roles → Add people**. Under the additional roles, choose **Instagram Tester**, enter the brand's exact Instagram username, and select the matching account. Some dashboards also offer this through **Generate access tokens → Add account** in the Instagram use case. Check that the tester is listed under the intended Meta app with a pending invitation.
2. In a separate browser tab, sign in to **Instagram as the exact invited brand account**. If the account was created through Accounts Center, use that account's existing sign-in or switch to it from an existing linked session. Confirm the active username.
3. Go to [Instagram Apps and Websites](https://www.instagram.com/accounts/manage_access/) and open **Tester Invites**. You can also get there from **Settings → App website permissions → Apps and websites**. Select **Accept** next to the expected Meta app. Check the Meta app's role list again to verify that the account is now an active Instagram Tester.

If the invitation is missing, first compare all three visible values: the Meta app in your dashboard, the username in its **Instagram Tester** role list, and the active username on instagram.com. Use the web settings to check **Tester Invites**. The regular Meta **Tester** role and the **Test Users** screen are separate. If the dashboard has no pending entry, submit the Instagram Tester invitation again from the correct app.

## 4. Generate and verify the token

1. In **Generate access tokens** on the selected API setup page, find the approved Instagram account and select **Generate token**. If the account is not listed, choose **Add account** and complete the prompt to sign in with that same Professional account. In Unified Login, a compatible configuration must be selected before token generation. Complete the Meta login popup, choose the intended Instagram asset, and approve the profile and publishing permissions.
2. Copy the Instagram User access token when Meta shows it. Save it directly as `INSTAGRAM_ACCESS_TOKEN` in **Settings → Secrets and variables → Actions → Secrets** in your private deployment repository. Keep it out of the profile JSON, logs, screenshots, chat, and version control. Dashboard-generated long-lived tokens typically last 60 days. [Meta token setup and refresh](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started)
3. For Instagram Login, with the token loaded as an environment variable in a private shell, make the following read-only request. Verify that `username` is your posting account. Put the returned `user_id` in the Actions variable `INSTAGRAM_ACCOUNT_ID`. The Meta App ID and the Instagram App ID are separate values.

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${INSTAGRAM_ACCESS_TOKEN}" \
  'https://graph.instagram.com/v27.0/me?fields=user_id,username'
```

Pass both values into the job that runs the publisher:

```yaml
env:
  INSTAGRAM_ACCOUNT_ID: ${{ vars.INSTAGRAM_ACCOUNT_ID }}
  INSTAGRAM_ACCESS_TOKEN: ${{ secrets.INSTAGRAM_ACCESS_TOKEN }}
```

For Unified Login, set the Actions variable **INSTAGRAM_GRAPH_HOST** to **graph.facebook.com**, pass it to the job as an environment variable, and use the Instagram account ID displayed in the dashboard. Verify the token against **GET /<INSTAGRAM_ACCOUNT_ID>?fields=username** on that host. With a Unified Login system-user token, **/me** identifies the integration user. See [Meta Unified Login authentication](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication) for account discovery, token types, and expiry settings.

## 5. Verify the first publication

1. Follow the [Cloudflare media Worker setup](cloudflare-setup.md#3-deploy-the-media-worker-for-instagram) and pass the Cloudflare settings to the same job. Instagram fetches the generated JPEG from the HTTPS media Worker before publishing.
2. From a checkout with Node.js 22.18 or later and dependencies installed, review a private preview with `npm start -- --profile profiles/example.json --mode preview`. Use your brand profile path in production.
3. When you are ready to make a real post, run `npm start -- --profile profiles/example.json --mode instagram`. Verify the returned media ID and open the destination Instagram account to see the published photo and caption. Use the manual run to verify the complete path before enabling scheduled publication.
4. Renew the token before it expires. To rotate it, update the existing private secret and repeat the account verification. [Meta long-lived token refresh](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login#refresh-access-token)

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| **My Apps** is empty | Check the signed-in Meta identity and the **All Apps** filter. A Meta app created in another signed-in account does not appear automatically. |
| **Tester Invites** is empty | Check the exact Instagram username, the signed-in Instagram account, the pending role in the intended Meta app, and that the role is **Instagram Tester**. |
| **Generate token** is missing or disabled | Accept the invite on Instagram, refresh the Meta dashboard, and check that you are in the Instagram Login setup. Use an eligible Professional account. |
| The token verifies a different account | Sign into the intended brand account during token generation and verify `username` again before replacing a deployment secret. |
| The token has expired | Generate a new token or refresh a still-valid long-lived token before expiry. Replace the old secret. |
| Meta cannot retrieve the image | Follow the [Cloudflare troubleshooting steps](cloudflare-setup.md#troubleshooting). |
