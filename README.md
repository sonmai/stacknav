# StackNav

Navigate GitHub stacked PRs from the VS Code status bar. StackNav is a small reviewer UI for [`github/gh-stack`](https://github.com/github/gh-stack).

When the current branch belongs to a locally loaded stack, the status bar shows:

`↓  2/4 · #184  ↑`

Click an arrow to move one layer. Click the middle to choose a layer from a VS Code Quick Pick; it moves the required number of local layers with `gh stack up/down`. When the current branch is active, merged layers are omitted because `gh-stack` skips them during navigation. The picker and tooltips show **PR number + title**, with the branch name underneath in the picker. The middle tooltip shows only the stack position, current PR number and title, and the first three non-empty description lines (up to 400 characters). The arrow tooltips show the next reachable PR. At the top or bottom, the unavailable arrow is hidden.

When you check out a PR branch that has no local stack, StackNav offers **Load stack for #184**. This detects a PR on the current branch, but cannot establish whether the PR belongs to a remote stack until you click Load. Loading uses the PR URL with `gh stack checkout`, fetches its stack locally, and may switch your local branch. An ordinary PR without a stack will report an error in **Output → StackNav**.

You can also run **StackNav: Load Stack from PR URL…** and paste a PR link without first checking out its branch. Links to the Files, Commits, and Checks tabs are accepted. Before checkout, StackNav checks the PR URL’s host and owner/repository against the repository resolved by GitHub CLI in the selected local folder. A mismatch or failed lookup stops loading. The command uses the active local repository, or asks you to choose one when there is no active repository in a multi-repository workspace.

Titles load for the stack in the background, with at most four lookups at once. Only the current layer requests a description; only its short preview is retained. Titles and previews are cached for five minutes during the session. If a title lookup fails, PR number and branch name remain available; navigation does not wait for titles. **StackNav: Refresh** clears the title cache.

The middle item and picker rows show short `merged`, `queued`, and `needs rebase` suffixes when applicable. On trunk, StackNav stays visible and offers **Go to First Layer** for the first unmerged layer. If all layers are merged, it shows trunk without a checkout action. When multiple local stacks share the trunk, **Select stack…** opens a picker and checks out the chosen stack’s first unmerged branch. Cancel leaves the checkout unchanged. StackNav rechecks the selection before switching.

## Setup

1. Install [GitHub CLI](https://cli.github.com/) and authenticate with `gh auth login`.
2. Install its stack extension: `gh extension install github/gh-stack`.
3. Install StackNav in VS Code, open a Git repository, and check out a PR branch.

The VS Code built-in Git extension must be enabled. In a workspace with multiple repositories, open a file from the desired repository to select it. StackNav runs in the Node workspace extension host (local desktop or remote workspace) with access to `gh`; it does not run in a browser extension host. It declares `vscode.git` as a dependency and reports unavailable/disabled Git when activation can run.

If the repository has multiple Git remotes, configure the intended one before loading a stack (for example, `git config remote.pushDefault origin`). If a different local stack already tracks those branches, resolve that conflict manually; StackNav does not unstack them.

## Commands

- **StackNav: Load Stack for Current PR** — explicitly fetch a remote stack to local branches.
- **StackNav: Load Stack from PR URL…** — fetch and check out a stack from a pasted PR link.
- **StackNav: Up** and **StackNav: Down** — switch between adjacent layers.
- **StackNav: Select Stack…** — choose among local stacks sharing the current trunk.
- **StackNav: Go to First Layer** — from trunk, enter the first unmerged layer with one `gh stack up` call.
- **StackNav: Select PR…** — choose a layer in the current local stack.
- **StackNav: Refresh** — re-read the current stack and PR.

The status bar refreshes after HEAD changes and StackNav actions, or when you run Refresh. Editing or saving a file does not trigger a stack lookup. HEAD changes during a checkout are coalesced into a refresh when it finishes. Stale background reads are cancelled when a new refresh supersedes them or the extension is disposed. In-progress checkout operations are not cancelled when switching editor repositories. There is no polling and no default keyboard shortcut.

## Safety

StackNav never calls `gh stack sync`, `push`, `submit`, `rebase`, or any command that writes remote branches or PRs. It uses `gh stack view --json` and `gh pr view --json` to display state, and `gh repo view --json url` to check repository identity before loading. Loading a remote stack with `gh stack checkout <PR URL>` fetches branches and sets up local tracking; navigation changes the local checkout. `gh stack view --json` may refresh PR status in local metadata. The multi-stack picker reads gh-stack schema-v1 metadata from Git’s resolved directory without modifying it, then uses `git switch --no-guess -- <branch>` for the selected local branch. Unsupported metadata produces an error rather than guessing. StackNav never stashes, resets, or forces a checkout. If a switch cannot safely carry local edits across, it reports the error.

## Automatic releases

Pull requests targeting `main` run **PR checks / test** (`npm ci` and `npm test`). Make this a required status check in the repository rules to block merging failures.

Every push to `main`, including a merged PR, runs **Release VSIX** in GitHub Actions. It installs locked dependencies, runs the tests, packages a VSIX, and publishes it under **Releases**. You can also run it manually from the Actions tab on `main`.

Release versions use the major/minor from `package.json` and the workflow run number as the patch: `0.1.1`, `0.1.2`, and so on. The VSIX version, filename, and Git tag agree. The version is set only in the build workspace; no version-bump commit is pushed. Failed runs may leave gaps in the numbering, and re-running an already published run keeps that release intact. Change major/minor in `package.json` when starting a new release series.

The workflow uses GitHub's automatic token with `contents: write`; no extra secret is required. Download `stacknav-<version>.vsix` from Releases and use **Extensions: Install from VSIX…** in VS Code.

## Development

```sh
npm install
npm test
```

`npm test` and VSIX prepublish both clean `out/` before compiling, so renamed tests and modules cannot survive from an earlier build.

Open this folder in VS Code and press **F5** to launch an Extension Development Host. The extension's compiled entry point is `out/src/extension.js`.
