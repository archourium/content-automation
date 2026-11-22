# Set up Cloudflare for Content Automation

Content Automation uses Workers AI to write a caption and generate a square JPEG. The GitHub runner calls the Workers AI REST API. Telegram accepts the JPEG directly. For Instagram publishing, deploy the included media Worker and D1 database so Meta can fetch each photo over HTTPS.

## 1. Connect Workers AI

1. Sign in to [Cloudflare](https://dash.cloudflare.com/) and select the account that should run inference. Use **Workers Free** if you want to stay within the free allocation. Cloudflare currently provides 10,000 Workers AI Neurons per account per day. Its [pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/) lists current limits, model pricing, and models that require a payment method.
2. Open **AI → Workers AI → REST API**. Select **Create a Workers AI API Token**.
3. Give the token a recognizable name such as **Content Automation Workers AI**. Leave **Workers AI Read** and **Workers AI Edit** in the permission list, limit the account resource to your selected account, and create the token.
4. Copy the token when Cloudflare displays it. Copy the **Account ID** from the REST API page. Use the Account ID from the same account selected in the token settings. See [Cloudflare's REST API setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/).
5. In your private GitHub deployment repository, open **Settings → Secrets and variables → Actions**. Add **CLOUDFLARE_API_TOKEN** under **Secrets** and **CLOUDFLARE_ACCOUNT_ID** under **Variables**. Store the token directly in the secret or in your local environment. Keep it out of the brand profile, command history, logs, and version control.

Configure the workflow step that runs the engine:

```yaml
env:
  CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
run: npm start -- --profile profiles/example.json --mode preview
```

Run this step after checking out the engine and running `npm ci` with Node.js 22.18 or later. Use your brand profile path when the profile lives outside the engine checkout.

## 2. Verify an actual image before publishing

Run the application in preview mode with the two Cloudflare settings. On a local checkout, you can copy [the example environment file](../.env.example) to `.env`, enter the two values, and run:

```sh
npm ci
node --env-file=.env src/cli.ts --profile profiles/example.json --mode preview
```

Open the JPEG and JSON in `output/`. The JPEG should be a 1080 × 1080 image and the JSON should report `"fixture": false`. The engine uses [GLM-4.7-Flash](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/) for the caption and [FLUX.1 Schnell](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) for the image. The `--fixture` option exercises the local pipeline with a placeholder. A successful fixture does not establish Cloudflare access.

For Telegram, connect the bot using [the Telegram setup](../README.md#set-up-telegram-on-windows) and run `--mode telegram` to send the generated image to the paired chat. If your application has a separate community workflow, run a live photo test against that community once you have authorization to post there. Verify that Telegram returned a message ID for a photo with a caption. If your scheduler uses fallback content, make sure the test requires a new Workers AI image so a fallback cannot pass the check. Use the scheduled run log to distinguish a newly generated image from a prepared fallback photo.

## 3. Deploy the media Worker for Instagram

The included Cloudflare Worker serves JPEGs from D1. D1 also stores trend snapshots and publication state to protect against duplicate Instagram posts. Before proceeding, install the dependencies as above, then authenticate your deployment session with Wrangler. Select the same account used for Workers AI.

```sh
npx wrangler login
npx wrangler whoami
npx wrangler d1 list
npx wrangler d1 create content-automation
```

If the database already exists, use its ID from `wrangler d1 list`. If you deploy separate instances to the same Cloudflare account, give each intended database and Worker a distinct name. Copy `cloudflare/wrangler.example.jsonc` to `cloudflare/wrangler.jsonc`. Set `database_id` to the D1 ID and match `database_name` to the database you created. Keep the binding name `DB`. If Wrangler requests a `workers.dev` subdomain, register it in the Cloudflare dashboard for this account.

```sh
npx wrangler d1 execute content-automation --remote --config cloudflare/wrangler.jsonc --file cloudflare/schema.sql
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

Run the commands from the checkout root. Use the HTTPS origin shown by the deploy command as `MEDIA_BASE_URL`. The Worker intentionally returns HTTP 404 for its root path. It serves only known, unexpired `/media/<id>.jpg` URLs. During publication, the engine stores each image with a one-day expiration and checks that Meta's image URL responds publicly before requesting publication.

Give the **runtime** token Workers AI Read/Edit and **D1 Edit** on the selected account. If replacing the Workers AI-only token, update the existing GitHub secret with the new token and rerun a preview. Wrangler's deployment login and the runner's runtime credentials are separate. For an isolated token, set **CLOUDFLARE_D1_API_TOKEN** as a GitHub Actions secret with account-scoped D1 Edit and pass it to the runner. The existing **CLOUDFLARE_API_TOKEN** can then stay scoped to Workers AI. Set the following in the private deployment repository:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| Variable | `CLOUDFLARE_D1_ID` | D1 database ID |
| Variable | `MEDIA_BASE_URL` | Deployed Worker HTTPS origin |
| Secret | `CLOUDFLARE_API_TOKEN` | Account-scoped Workers AI and D1 token |

Pass the matching variables as environment variables to the publish step, complete the [Instagram authorization](../README.md#connect-instagram), and run a manual publication before enabling a schedule.

### Use a Worker-scoped storage key

If the deployment should avoid granting GitHub Actions access to the full Cloudflare account's D1 API, generate a random key and set it as the Worker secret **MEDIA_STORAGE_TOKEN** with Wrangler. Save the same key as **MEDIA_STORAGE_TOKEN** in the private GitHub repository and pass it into the publish job. Keep **CLOUDFLARE_API_TOKEN** scoped to Workers AI. The Worker allows only the library's parameterized queries on its bound D1 database. The photo URLs remain public until their expiration so Meta can fetch the image.

Use **MEDIA_STORAGE_TOKEN** only with the HTTPS origin of your own deployed media Worker. Verify the deployment with a preview or manual publication after changing credentials.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Configuration is missing | Confirm the account ID is an Actions variable, the token is an Actions secret, and the workflow maps both to the engine environment. Check the repository and environment where you saved them. |
| Workers AI reports HTTP 401 or 403 | Check that the token belongs to the account ID and includes both Workers AI permissions. Replace the secret if the token expired or was revoked. |
| Workers AI reports a quota or rate limit | Check the account's Workers AI dashboard. Daily free usage resets at 00:00 UTC. Leave the account on Workers Free to prevent paid inference. |
| Preview succeeds but the Telegram group posts text | Open the group workflow's run log and check for a warning about generation or configuration. Confirm the group workflow reads the same account ID and token as the successful preview, then run a live photo test. |
| D1 rejects a write | Check the runtime token's D1 permission, database ID, and that `schema.sql` was applied with `--remote` to the deployed database. |
| Meta cannot fetch the image | Verify that the configured HTTPS origin is reachable from the public internet and that the deployed Worker binds the same D1 database used by the runner. Check the media URL during the run before it expires. |
