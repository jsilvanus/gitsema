---
"gitsema": minor
---

Adopt changesets for versioning, changelog generation, and npm publishing. Releases are now driven by the changesets "Version Packages" PR on `main` (published to npm via OIDC trusted publishing) instead of manually pushed `v*` tags. Contributors add a changeset file (`pnpm exec changeset`) with each user-facing change; CHANGELOG.md is generated from these entries.
