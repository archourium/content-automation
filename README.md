# Content Automation

Reusable Node.js library and CLI for daily, trend-aware Instagram photo posts. Each brand supplies its own JSON profile. The engine reads Google Trends, drafts a caption, and renders a square JPEG. The same pipeline runs as a local preview, previews in a private Telegram chat, or publishes through Instagram Login.

## Mulai di Windows

1. [Unduh Setup Telegram untuk Windows](https://github.com/archourium/content-automation/releases/latest/download/Setup-Telegram-Windows.zip) dan pilih **Extract All / Ekstrak Semua**. Jika aplikasi Anda sudah menyertakan launcher, buka folder aplikasinya.
2. Klik dua kali **Mulai Setup Telegram.cmd**. Setup memeriksa komponen yang diperlukan dan memandu login GitHub jika dibutuhkan.
3. Tempel token bot dari [BotFather](https://t.me/BotFather), lalu tekan **Start** di Telegram. Saat terhubung, bot mengirim pesan tes ke chat Anda.

Launcher membaca tujuan dari proyek. Untuk unduhan mandiri, masukkan alamat repo GitHub privat tempat otomatisasi Anda berjalan. Bot harus dapat menerima pesan dari chat pribadi Anda. Setup akan meminta Anda memakai bot tersendiri bila bot yang dipilih sudah terhubung ke webhook lain.

## Install in an application

Install the compiled package from the GitHub release:

```sh
npm install --save-dev https://github.com/archourium/content-automation/releases/download/v0.3.0/content-automation-0.3.0.tgz
```

Copy `Mulai Setup Telegram.cmd` from the package to the application's root, next to its `package.json`. Set the following field in that manifest so people can launch setup directly:

```json
{
  "contentAutomation": { "repository": "OWNER/PRIVATE_REPO" }
}
```

For macOS, Linux, or terminal use, run `node node_modules/content-automation/scripts/connect-telegram.mjs` from the application root. The wizard requires Node.js 22.18+ and GitHub CLI with access to the deployment repo. Use `--repo OWNER/PRIVATE_REPO` to select a different deployment or `--check` to check access without pairing.

The connection test runs without Cloudflare or Instagram. For automated runs, pass the `TELEGRAM_CONNECTION` Actions secret to the CLI and use `--mode telegram-check` to test it, or `--mode telegram` to send a generated photo and caption. Generating a new photo uses Cloudflare Workers AI.

## Local preview

Use Node.js 22.18 or newer.

```sh
npm ci
npm run check
npm test
npm start -- --profile profiles/example.json --fixture
```

The fixture verifies the real RSS read and JPEG output using a local placeholder and sample caption. It cannot publish. Remove `--fixture` for a Workers AI preview after setting `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the environment. Outputs appear under `output/`. To load a local environment file, use `node --env-file=.env src/cli.ts --profile profiles/example.json`.

## Brand profile

Copy `profiles/example.json`. Change the brand voice, audience, visual direction, and fallback topics. The feed region and IANA timezone control trend selection. Give each brand its own profile and Instagram authorization. The scheduler owns the daily posting time. A profile can also be imported by another Node application using the package exports and the `Generator` interface.

## Connect services

1. Use a Cloudflare Free account. Create a D1 database named `content-automation` with `npx wrangler d1 create content-automation`. Copy `cloudflare/wrangler.example.jsonc` to `cloudflare/wrangler.jsonc` and insert the database ID.
2. Run `npx wrangler d1 execute content-automation --remote --config cloudflare/wrangler.jsonc --file cloudflare/schema.sql`. Run `npx wrangler deploy --config cloudflare/wrangler.jsonc` and use the deployed HTTPS URL as `MEDIA_BASE_URL`. The Worker serves only unexpired images at unguessable URLs so Meta can fetch them. Images expire after one day and are cleaned up during subsequent runs.
3. Create a Cloudflare API token scoped to the runtime account with Workers AI and D1 write access. Set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_ID` and `MEDIA_BASE_URL` in the private scheduler. Workers AI Free uses a shared daily account quota.
4. Use Instagram API with Instagram Login on the Professional account. Authorize `instagram_business_basic` and `instagram_business_content_publish`. Set `INSTAGRAM_ACCOUNT_ID` and `INSTAGRAM_ACCESS_TOKEN` in the private scheduler. Use a long-lived token and renew it before expiration. For recurring use, monitor for authentication failures and renew the token on the instance when required.
5. Run locally with `--mode preview` before publishing. For a Telegram preview, follow the setup above, then use `--mode telegram` on the configured runner. Use `--mode instagram` to publish from an authorized installation. Telegram credentials are optional in Instagram mode and enable failure notifications for generation or publishing errors.

Keep real profiles and credentials in the private deployment repository or its secrets. On GitHub, run the CLI from a private Actions repository, check out a pinned version of the library, install dependencies with `npm ci` and pass the profile path. Set an Actions spending limit of zero if billing is enabled on the account. Avoid running the production schedule in a public repo where GitHub can disable an inactive schedule.

The publication key is the destination Instagram account and local date. Retrying a completed run skips the post. If the publish response was lost, a later run checks the original Instagram container. For an unresolved container, inspect the account and container before manually resetting the date's state. Keep one timezone per destination account.

## Upstream documentation

- [Instagram Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Google Trends RSS](https://support.google.com/trends/answer/3076011)
- [Cloudflare Workers AI free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [GitHub Actions billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage)
