# Security

SORYN's public build observes a public Solana wallet and market data. Decision execution is simulated: it does not sign or broadcast transactions or spend wallet funds.

Never commit private keys, seed phrases, API secrets, signer credentials, wallet keypair files, or deployment tokens. Keep credentials in your local environment or the deployment platform's secret store. If a credential is exposed, revoke or rotate it before reporting the issue.

Please report security vulnerabilities privately to the repository maintainers through GitHub's private vulnerability reporting feature, if available. Do not include exploitable details or credentials in a public issue. For non-sensitive bugs, open a regular issue with reproduction steps.

Security reports should identify the affected component, the impact, and a minimal reproduction. The maintainers will review the report and coordinate a fix and disclosure.
