# Issue Drafts (Human-in-the-Loop staging)

AI agents write proposed issues here as local markdown files. **Nothing in this
folder is submitted automatically.** A human reviews each draft, validates it,
and — only if they choose to — copies it into a real GitHub issue under their
own identity.

## Workflow

1. The agent generates `.github/drafts/<slug>.md` from the template below and
   presents a compliance report (see [../AGENT_RULES.md](../AGENT_RULES.md)).
2. Validate the draft:

   ```bash
   node scripts/verify-issue.mjs .github/drafts/<slug>.md
   ```

3. You review, edit, and — if appropriate — submit it manually.

Generated drafts (`*.md` other than this README and `TEMPLATE.md`) are
git-ignored so they never accidentally get committed.

## Template

See [TEMPLATE.md](TEMPLATE.md).
