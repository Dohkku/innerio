<p align="center">
  <img src=".github/innerio-logo.png" alt="Innerio" width="240" />
</p>

# Innerio

A task manager built on GTD, the Getting Things Done method by David Allen. Capture in a second, decide once what each thing is, and keep your data encrypted on your own devices.

**Try it:** [innerio.frederickandrade.com](https://innerio.frederickandrade.com) · no account needed.
En español: la web y la app están en español, y la guía de GTD también.

## What it does

- **Inbox and processing.** Everything goes to the inbox. Processing shows one item at a time and each decision is a key: action, project, calendar, reminder, done, discard, skip.
- **Next actions, projects, calendar, reminders.** Projects can be sequential or parallel. Recurring tasks advance on their own.
- **Local AI assistant (optional).** While processing, press G and a model running on your own machine through [Ollama](https://ollama.com) proposes three concrete next actions. Nothing is sent anywhere.
- **Offline first.** Data lives in the browser (IndexedDB) and syncs when there is a connection.
- **End-to-end encryption.** With an account, titles, notes and the rest of the text are encrypted on your device before they leave. The server stores ciphertext and never has the key.
- **Installable.** Web app (installable as a PWA on desktop and mobile) and a Linux desktop app with signed automatic updates.

## Run it locally

Requires [Bun](https://bun.sh) 1.3 or newer.

```bash
bun install
cd apps/web
bun run dev
```

Open http://localhost:5173. Without a sync server everything stays in your browser.

To run your own sync server (multi-device sync, accounts, E2EE), see [docs/self-host.md](docs/self-host.md).

## Repository layout

| Path | What |
|---|---|
| `apps/web` | SvelteKit 2 + Svelte 5 app (static SPA) |
| `apps/triplit-server` | Sync and auth server (Bun, Hono, Triplit, Better Auth, SQLite) |
| `apps/desktop` | Electron shell for Linux, with the self-updater |
| `apps/mobile` | Capacitor shell for Android |
| `packages/schema` | Shared Triplit schema and permissions |
| `packages/crypto` | E2EE primitives (Argon2id, XChaCha20-Poly1305, BIP39 recovery words) |
| `packages/core` | Date and state helpers shared by app and server |

## Checks

```bash
bun run --cwd apps/web typecheck
bun run --cwd apps/web test
bunx biome check .
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: please write to dohkku@dohkku.dev instead of opening a public issue.

## License

[AGPL-3.0](LICENSE). Made by [Frederick Andrade](https://frederickandrade.com).
