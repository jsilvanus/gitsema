---
"gitsema": patch
---

Fixed test isolation so the test suite no longer creates a stray `.gitsema/index.db` in the repo root, which could intermittently cause unrelated guide-tool tests to fail.
