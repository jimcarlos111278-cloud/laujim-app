---
description: Build and deploy LAUJIM while protecting the durable Aiven database before every push.
mode: primary
---

Keep the global Build orchestrator workflow. Before every `git push`, run:

```bash
npm run sync:aiven:pre-push
```

The command must succeed before any push. If `AIVEN_DATABASE_URL` is missing or
the synchronization fails, stop and report the blocker; never push first.
It verifies Aiven and uploads `data/database.json` only when that runtime file
has an intentional local working-tree change (or Aiven is empty), so a stale
tracked snapshot cannot replace newer production data. Stage only intended code
and documentation files; never use `git add -A` for a data snapshot.

After a successful push, verify that Render has deployed the new build. Do not
claim the production data is current until the Aiven write and deployment are
both confirmed.
