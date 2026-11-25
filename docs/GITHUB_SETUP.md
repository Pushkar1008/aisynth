# GitHub and Claude Code setup

## A. Put the project on GitHub (once)

1. Install [Git for Windows](https://git-scm.com/download/win) and sign in at github.com.
2. On github.com choose **New repository**. Name it `aisynth`, pick **Private**, and leave "Add a README", ".gitignore" and "license" **unticked** so the repo is empty.
3. Unzip the project. The folder already contains a git history. In PowerShell:
   ```powershell
   cd path\to\aisynth
   git config user.name  "Your Name"
   git config user.email "you@example.com"
   git remote add origin https://github.com/<your-username>/aisynth.git
   git branch -M main
   git push -u origin main
   ```
   A browser window opens the first time to sign you in (Git Credential Manager).
   With the GitHub CLI instead: `gh auth login`, then `gh repo create aisynth --private --source . --push`.
4. Refresh the repo page. You should see the files, and a green tick under **Actions** after a minute (the CI build).

## B. Connect Claude Code (daily workflow)

1. Install Claude Code. PowerShell: `irm https://claude.ai/install.ps1 | iex` (or `winget install Anthropic.ClaudeCode`). Check with `claude --version`. It needs a Claude Pro, Max, Team or Enterprise plan, or an API (Console) account. Details: https://code.claude.com/docs/en/setup
2. Get the code on the machine you work on (skip if you already have the folder):
   ```powershell
   git clone https://github.com/<your-username>/aisynth.git
   cd aisynth
   npm install
   ```
3. Start Claude Code inside the folder and sign in when the browser opens:
   ```powershell
   claude
   ```
   It reads `CLAUDE.md` automatically, so it already knows the layout, commands and gotchas.
4. Each time you want a change:
   ```powershell
   git pull
   git checkout -b feature/short-name
   claude
   ```
   Describe the change, for example "add a Stop button to the workflow run log". Review what it proposes, let it run `npm run build`, then ask it to "commit and push". Open a pull request on GitHub (or ask Claude to run `gh pr create`) and merge when CI is green.
5. Tips: run `/clear` between unrelated tasks, keep changes small, and put new lasting rules into `CLAUDE.md`.

### Other ways to use Claude with this repo

- **Claude Code on the web or in the desktop app:** connect your GitHub account at claude.ai/code, choose the `aisynth` repo and describe the change; it works in a cloud copy and can push a branch.
- **`@claude` on issues and pull requests:** inside Claude Code run `/install-github-app` and follow the prompts (check the current steps in the docs first).

## Housekeeping

- `node_modules/`, `build/` and `dist/` are git-ignored. Never commit them.
- There is no secret in this project. If you add API keys later, keep them in a git-ignored `.env`.
- Repo visibility is your choice. Add a `LICENSE` file before making it public.
