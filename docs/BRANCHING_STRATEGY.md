# ZedProcure — Git Branching Strategy

## Branch Overview

| Branch       | Purpose                                           | Deploys to          |
|:-------------|:--------------------------------------------------|:--------------------|
| `production` | Stable, live code only. Never commit here directly | Render (Production) |
| `staging`    | Pre-release integration testing                   | Render (Staging)    |
| `test`       | Automated tests and QA verification               | CI/CD (Test env)    |
| `working`    | Safe snapshot of the current stable working state | —                   |
| `features`   | New feature development (branch off this)         | —                   |
| `main`       | Latest integrated code; base for all branches     | Render (auto)       |

## Workflow

### Developing a new feature
```bash
# Branch from features (or main)
git checkout features
git pull origin features
git checkout -b features/your-feature-name

# ... develop, commit locally ...
git add -A
git commit -m "feat: describe your change"

# Push and open a PR into staging
git push origin features/your-feature-name
```

### Promoting code
```
features/xxx  →  staging  →  test  →  production
```

1. **PR from `features/xxx` → `staging`**: Code review + integration test.
2. **PR from `staging` → `test`**: QA and automated test run.
3. **PR from `test` → `production`**: Final release after all tests pass.

### Hotfix
```bash
git checkout production
git pull origin production
git checkout -b hotfix/critical-bug-description
# ... fix, commit ...
git push origin hotfix/critical-bug-description
# Open PR into production AND backport into main / staging
```

### Safe snapshot (working)
The `working` branch is a snapshot of the last fully working state.  
Update it **before** starting any large refactor:
```bash
git checkout working
git merge main --ff-only
git push origin working
```

## Rules
- **Never push directly to `production`** — always use a PR.
- **Never force-push** to `main`, `staging`, or `production`.
- All PRs must have at least one reviewer approval before merge.
- Keep commit messages in the **Conventional Commits** format:  
  `type(scope): short description` — e.g. `fix(supplier): correct upsert logic`
