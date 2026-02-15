# Pegasus Retools Engine

**AI-powered PR generation workflow for Retools**

Automated GitHub Actions workflow that clones user repositories, applies AI-powered changes, and creates pull requests.

---

## 🚀 Overview

This repository contains the GitHub Actions workflow that:

1. **Receives job requests** from the Retools builder queue via workflow dispatch
2. **Clones the user's repository** using their GitHub token
3. **Applies AI changes** based on the user's prompt using Claude
4. **Builds the project** (if applicable) to validate changes
5. **Pushes a feature branch** to the user's repository
6. **Creates a pull request** with the AI-generated changes
7. **Sends webhooks** back to Retools with status updates

---

## 🏗️ Architecture

```
Retools Builder Queue → [workflow_dispatch] → GitHub Actions → User's Repo (PR)
                                                     ↓
                                                 Webhook
                                                     ↓
                                              Retools API
```

### Workflow Inputs

The workflow is triggered via `workflow_dispatch` with a single JSON payload input:

```json
{
  "job_id": "job-abc123...",
  "repo_url": "https://github.com/user/repo",
  "branch": "main",
  "prompt": "Add a dark mode toggle to the header",
  "github_token": "ghp_...",
  "webhook_url": "https://retools.streamcube.link/api/webhooks/pegasus",
  "user_email": "user@example.com",
  "user_name": "John Doe"
}
```

---

## 🔧 Workflow Steps

### 1. Parse Job Payload
Extracts job details from the JSON input and sets up environment variables.

### 2. Setup User GitHub Token
Masks the user's GitHub token and stores it securely (never in `GITHUB_OUTPUT`).

### 3. Checkout User Repository
Clones the user's repository using their token and checks out the target branch.

### 4. Setup Dependencies
Detects the project type and installs dependencies:
- **Node.js**: pnpm, yarn, or npm
- **Python**: pip
- **Ruby**: bundler

### 5. Apply AI Changes
Uses Claude API to generate code changes based on the user's prompt.

**Key Features:**
- Framework-agnostic (preserves React, Vue, Python, etc.)
- Minimal, targeted changes
- Respects existing code style

### 6. Commit Changes
Commits the AI-generated changes with a descriptive message.

### 7. Build Project (Optional)
Runs the build script if present to validate changes.

### 8. Push Branch
Creates a feature branch (`retools/ai-changes-{timestamp}`) and pushes to the user's repo.

### 9. Create Pull Request
Uses GitHub API to create a PR with:
- Title: First 72 chars of the prompt
- Body: Full prompt + Retools attribution

### 10. Send Webhooks
Sends status updates to Retools at each major step:
- `cloning_complete`
- `ai_complete`
- `completed` (with PR URL)
- `failed` (on error)

---

## 🔐 Required Secrets

Configure at: https://github.com/YOUR_ORG/pegasus-retools-engine/settings/secrets/actions

| Secret | Description | Where to Get |
|--------|-------------|--------------|
| `ANTHROPIC_API_KEY` | Claude AI API key | https://console.anthropic.com |
| `RETOOLS_WEBHOOK_SECRET` | HMAC secret for webhook signatures | Generate random string (shared with Retools app) |

**Note:** User GitHub tokens are passed in the workflow payload, not stored as secrets.

---

## 📜 Script Inventory

All pipeline logic lives in `scripts/`:

| Script | Purpose |
|--------|---------|
| `ai-driver.js` | Calls Claude API to generate code changes |
| `webhook-driver.js` | Sends HMAC-signed webhooks to Retools |

---

## 🔒 Security Features

### User Token Handling
- Token is masked immediately with `::add-mask::`
- Stored in `/tmp/user_github_token.txt` (never in `GITHUB_OUTPUT`)
- Deleted in cleanup step (runs even on failure)
- Used for: clone, push, PR creation

### Webhook Signatures
All webhooks include HMAC-SHA256 signature:

```
x-webhook-signature: <hex-encoded-hmac>
```

Calculated as:
```javascript
const hmac = crypto.createHmac('sha256', RETOOLS_WEBHOOK_SECRET);
hmac.update(JSON.stringify(payload));
const signature = hmac.digest('hex');
```

---

## 🛠️ Development

### Local Testing

You can test the workflow locally using [act](https://github.com/nektos/act):

```bash
# Install act
brew install act

# Create test payload
cat > test-payload.json <<EOF
{
  "job_id": "job-test-123",
  "repo_url": "https://github.com/YOUR_USERNAME/test-repo",
  "branch": "main",
  "prompt": "Add a README file",
  "github_token": "ghp_YOUR_TOKEN",
  "webhook_url": "https://webhook.site/YOUR_UNIQUE_URL"
}
EOF

# Run workflow
act workflow_dispatch \
  --secret ANTHROPIC_API_KEY=sk-... \
  --secret RETOOLS_WEBHOOK_SECRET=your-secret \
  --input job_payload="$(cat test-payload.json)"
```

---

## 📊 Monitoring

### View Workflow Runs

https://github.com/YOUR_ORG/pegasus-retools-engine/actions/workflows/retools-pr.yml

### Check Job Status

Query the Retools API:

```bash
curl "https://retools.streamcube.link/api/jobs/{job_id}"
```

---

## 🔗 Related Repositories

| Repository | Role |
|-----------|------|
| [Retools](https://github.com/YOUR_ORG/Retools) | SvelteKit app + builder queue |
| [retools-builder-queue](../retools-builder-queue) | Queue consumer that triggers this workflow |

---

## 📄 License

Private — © 2026 Nexartis, LLC. All rights reserved.

Part of the Retools ecosystem.

