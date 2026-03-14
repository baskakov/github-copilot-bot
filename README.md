# GitHub Copilot Telegram Bot

A Telegram bot that integrates with **GitHub Copilot** to let you chat with AI models directly from Telegram. The bot connects to the [Bask-Agency](https://github.com/Bask-Agency) GitHub organisation where Copilot is configured, fetches the available AI models, and lets you select one via inline buttons before starting a conversation.

---

## Features

- **Model selection** — pick an AI model (Claude, GPT-4o, o1, Mistral, Llama, etc.) via Telegram inline buttons
- **Conversation memory** — keeps the last 20 turns of context per user
- **Allowlist** — only users whose Telegram IDs are in `ALLOWED_USER_IDS` can use the bot
- **Auto token refresh** — Copilot session tokens are exchanged and refreshed automatically
- **Fallback** — if the full Copilot catalog is unavailable, falls back to the GitHub Models API

---

## Project Structure

```
src/
├── index.ts           — Entry point & graceful shutdown
├── bot.ts             — All Telegram command & message handlers
├── copilotService.ts  — GitHub Copilot API integration (models + chat)
├── sessionManager.ts  — Per-user session state & conversation history
├── config.ts          — Environment variable loading & validation
└── auth.ts            — One-time OAuth device-flow authentication
```

---

## Prerequisites

- **Node.js** v18 or later
- **npm** v8 or later
- A **Telegram Bot token** — create one via [@BotFather](https://t.me/BotFather)
- A **GitHub account** that is a Copilot seat in the `Bask-Agency` organisation
- A **GitHub OAuth token** with Copilot access (obtained via `npm run auth` — see below)

---

## Setup

### 1. Clone & install dependencies

```bash
git clone git@github.com:baskakov/github-copilot-bot.git
cd github-copilot-bot
npm install
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Then open `.env` and fill in the values:

```dotenv
# Telegram Bot Token from @BotFather
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# GitHub OAuth token — obtained via: npm run auth
GITHUB_TOKEN=your_github_oauth_token_here

# GitHub Organisation slug
GITHUB_ORG=My-Org

# Comma-separated list of allowed Telegram user IDs (numeric)
# Get your ID from @userinfobot on Telegram
ALLOWED_USER_IDS=123456789,987654321
```

### 3. Authenticate with GitHub Copilot (one-time)

The bot needs an OAuth token — not a PAT — to access the full Copilot model catalog (Claude, GPT-4.5, o1, etc.). Run the authentication script once:

```bash
npm run auth
```

It will print something like:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1. Open: https://github.com/login/device
  2. Enter code: XXXX-XXXX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

1. Open the URL in your browser
2. Enter the displayed code
3. Authorize the app with your GitHub account (must be a Copilot seat in `Bask-Agency`)

Once authorized, the token is **automatically saved** to your `.env` file as `GITHUB_TOKEN`.

> **Note:** This uses the same OAuth App (`Iv1.b507a08c87ecfe98`) that VS Code uses for GitHub Copilot, which is what grants access to the full model catalog.

---

## Running the Bot

### Development (auto-restart on file changes)

```bash
npm run dev
```

### Production

```bash
npm run build   # Compile TypeScript → dist/
npm start       # Run compiled JS
```

---

## Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message + model picker |
| `/model` | Show inline keyboard to select or switch AI model |
| `/clear` | Reset conversation history |
| `/info` | Show currently selected model and session stats |
| `/help` | List all available commands |

Any plain text message (not a command) is sent to the selected Copilot model and the reply is returned directly in chat. Conversation history (up to 20 turns) is maintained per user so the model has full context.

---

## How It Works

```
Telegram user
     │
     ▼
 Telegram Bot (node-telegram-bot-api)
     │
     ├─ /model command ──► fetch models from api.githubcopilot.com
     │                      (falls back to models.inference.ai.azure.com)
     │
     └─ chat message ───► exchange GitHub OAuth token for Copilot session token
                           └─► POST /chat/completions to api.githubcopilot.com
                                └─► reply sent back to Telegram user
```

**Token flow:**

1. `GITHUB_TOKEN` (OAuth) is exchanged for a short-lived **Copilot session token** via `GET /copilot_internal/v2/token`
2. The session token is cached and auto-refreshed before it expires (~30 min)
3. All model listings and chat requests use this session token against `api.githubcopilot.com`

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from [@BotFather](https://t.me/BotFather) |
| `GITHUB_TOKEN` | Yes | GitHub OAuth token (run `npm run auth`) |
| `GITHUB_ORG` | Yes | GitHub org slug (`Bask-Agency`) |
| `ALLOWED_USER_IDS` | Yes | Comma-separated Telegram user IDs allowed to use the bot |

---

## Security Notes

- The bot **rejects all messages** from Telegram users not listed in `ALLOWED_USER_IDS`
- `.env` is git-ignored and never committed
- The Copilot session token is kept in memory only and never persisted to disk

---

## License

Private — © Bask-Agency




