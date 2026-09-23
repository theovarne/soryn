# Contributing

1. Fork the repository and create a focused branch.
2. Run `npm ci`, `npm run check`, and `npm test` with Node.js 20 or newer.
3. Open a pull request describing the behavior, data source, and any relevant tests.

Keep simulation explicit and preserve the distinction between a public wallet address and a project token mint. Do not introduce invented market data or hide an unavailable source behind a made-up value. Preserve field provenance and keep UI changes small and consistent with the observatory. Never commit secrets, private keys, seed phrases, or signer credentials.
