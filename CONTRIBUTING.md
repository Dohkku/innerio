# Contributing to Innerio

Thanks for your interest. Innerio has one maintainer, so the process is light.

## What's welcome

- **Bug reports and fixes.** Always welcome.
- **Features.** Open an issue first and describe the problem and the rough shape of the solution, so we can agree before you write code.
- **Translations.** The interface is in Spanish today. Open an issue to coordinate.

## Dev setup

Requires [Bun](https://bun.sh) 1.3 or newer.

```bash
bun install
cd apps/web && bun run dev   # http://localhost:5173
```

The sync server is only needed for accounts and multi-device sync. See [docs/self-host.md](docs/self-host.md).

## Conventions

- **Package manager:** Bun. Please don't use npm or pnpm.
- **Lint and format:** Biome 1.9 (`bunx biome check .`, add `--write` to fix). Svelte files are checked by `svelte-check` through `bun run --cwd apps/web typecheck`.
- **Tests:** Vitest (`bun run --cwd apps/web test`).
- **Language:** user-facing strings in Spanish; code, comments and commit messages in English.
- **TypeScript:** strict.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`...).
- Sign off your commits (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/). No copyright assignment is needed.
- Keep pull requests focused, with typecheck, tests and Biome passing.

## Security

Please report vulnerabilities privately to dohkku@dohkku.dev instead of opening a public issue.

## Code of conduct

This project follows the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Reports go to dohkku@dohkku.dev.

## License

AGPL-3.0, see [LICENSE](LICENSE). Contributions are accepted under the same license.
