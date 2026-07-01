---
"gitsema": patch
---

Fix a gap in the audit log: attaching as a reader to an existing public repo (the "attach-as-reader" auto-grant on `POST /api/v1/remote/index`) now records a `grant.create` audit event, matching every other `repo_grants` write path.
