# Contributing

Fork the repository, create a branch and make a focused change. Preserve the bounded engine, safe local defaults and explainable reasoning.

```sh
npm ci
npm test
npm run typecheck
npm run build
```

Security, privacy, fail-open and detection changes should include meaningful regression tests. Never add real credentials, private request content, databases, temporary tunnel URLs or fabricated results. Do not remove failing tests to get green checks.

Submit a pull request explaining the problem, resulting behavior and verification. Use heuristic assessment language. Document actual adapter coverage and limitations. Avoid disclosing sensitive security details in public issues before agreeing on a disclosure channel with the maintainer.
