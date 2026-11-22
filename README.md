# Content Automation

Reusable Node.js library and CLI for daily, trend-aware Instagram photo posts. Each brand supplies its own JSON profile. The engine reads Google Trends, drafts a caption, and renders a square JPEG. The same pipeline runs as a local preview, previews in a private Telegram chat, or publishes through Instagram Login.

## Set up Telegram on Windows

1. [Download Telegram Setup for Windows](https://github.com/archourium/content-automation/releases/latest/download/Setup-Telegram-Windows.zip) and choose **Extract All**. If your application already includes the launcher, open the application folder.
2. Double-click **Set Up Telegram.cmd**. Setup checks its dependencies and guides you through GitHub sign-in if needed.
3. Paste the bot token from [BotFather](https://t.me/BotFather), then press **Start** in Telegram. The bot will send a connection test to the paired private chat.

The launcher reads the deployment repository from the application configuration. If you use the standalone download, enter the URL of your private deployment repository when prompted. Use a dedicated bot if your existing bot has a webhook.

## Install in an application

Install the compiled package from the GitHub release:

```sh
npm install --save-dev https://github.com/archourium/content-automation/releases/download/v0.3.1/content-automation-0.3.1.tgz
```

Copy `Set Up Telegram.cmd` from the package to the application's root, next to its `package.json`. Set the following field in that manifest so people can launch setup directly:

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

## Set up Cloudflare

Follow the [Cloudflare setup guide](docs/cloudflare-setup.md) to create a Workers AI token, preview a generated JPEG, and verify Telegram delivery. The guide also covers deploying the D1-backed media Worker for Instagram.

## Connect Instagram

1. Set up Cloudflare Workers AI, D1, and the media Worker using the guide above.
2. Use Instagram API with Instagram Login for a Professional account. Authorize `instagram_business_basic` and `instagram_business_content_publish`. Set `INSTAGRAM_ACCOUNT_ID` and `INSTAGRAM_ACCESS_TOKEN` in the private scheduler. Use a long-lived token and renew it before it expires.
3. Run `--mode preview` to review the generated image and caption. Run `--mode instagram` from the authorized installation to publish. Telegram is optional in Instagram mode and can notify you if generation or publishing fails.

Keep real profiles and credentials in the private deployment repository or its secrets. On GitHub, run the CLI from a private Actions repository, check out a pinned version of the library, install dependencies with `npm ci` and pass the profile path. Set an Actions spending limit of zero if billing is enabled on the account. Avoid running the production schedule in a public repo where GitHub can disable an inactive schedule.

The publication key is the destination Instagram account and local date. Retrying a completed run skips the post. If the publish response was lost, a later run checks the original Instagram container. For an unresolved container, inspect the account and container before manually resetting the date's state. Keep one timezone per destination account.

## Upstream documentation

- [Instagram Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Google Trends RSS](https://support.google.com/trends/answer/3076011)
- [Cloudflare Workers AI free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [GitHub Actions billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage)
