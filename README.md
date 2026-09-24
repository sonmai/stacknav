# StackNav

Navigate GitHub stacked PRs from the VS Code status bar. StackNav is a small reviewer UI for [`github/gh-stack`](https://github.com/github/gh-stack).

When the current branch belongs to a locally loaded stack, the status bar shows:

`↓  2/4 · #184  ↑`

Click an arrow to move one layer. Click the middle to choose any layer from a VS Code Quick Pick; it moves the required number of local layers with `gh stack up/down`. At the top or bottom, the unavailable arrow is hidden.

When you check out a PR branch that has no local stack, StackNav offers **Load stack for #184**. This detects a PR on the current branch, but cannot establish whether the PR belongs to a remote stack until you click Load. Loading uses the PR URL with `gh stack checkout`, fetches its stack locally, and may switch your local branch. An ordinary PR without a stack will report an error in **Output → StackNav**.

## Setup

1. Install [GitHub CLI](https://cli.github.com/) and authenticate with `gh auth login`.
2. Install its stack extension: `gh extension install github/gh-stack`.
3. Install StackNav in VS Code, open a Git repository, and check out a PR branch.

The VS Code built-in Git extension must be enabled. In a workspace with multiple repositories, open a file from the desired repository to select it. StackNav requires a desktop VS Code extension host with access to `gh`.

## Commands

- **StackNav: Load Stack for Current PR** — explicitly fetch a remote stack to local branches.
- **StackNav: Up** and **StackNav: Down** — switch between adjacent layers.
- **StackNav: Select PR…** — choose a layer in the current local stack.
- **StackNav: Refresh** — re-read the current stack and PR.

The status bar refreshes after branch changes and StackNav actions. There is no polling and no default keyboard shortcut.

## Safety

StackNav never calls `gh stack sync`, `push`, `submit`, `rebase`, or any command that writes remote branches or PRs. It uses `gh stack view --json` and `gh pr view --json` to display state. Loading a remote stack with `gh stack checkout <PR URL>` fetches branches and sets up local tracking; navigation changes the local checkout. `gh stack view --json` may refresh PR status in local metadata. StackNav never stashes, resets, or forces a checkout. If a switch cannot safely carry local edits across, it reports the error.

## Development

```sh
npm install
npm test
```

Open this folder in VS Code and press **F5** to launch an Extension Development Host. The extension's compiled entry point is `out/src/extension.js`.
