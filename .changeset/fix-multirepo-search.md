---
"gitsema": patch
---

Fix `multi_repo_search` returning the wrong repository's results and leaking
database connections. Each repo's index is now made the active session for its
search (so results come from that repo, not the caller's working directory),
the connection is closed afterwards, and the process-global search result cache
key now includes the active database path so searches against different indexes
in one process no longer collide.
