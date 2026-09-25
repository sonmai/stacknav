# StackNav

<p align="center">
  <img src="media/icon.png" width="128" height="128" alt="StackNav logo">
</p>

<p align="center"><strong>Review GitHub stacked pull requests without losing your place.</strong></p>

StackNav brings [`github/gh-stack`](https://github.com/github/gh-stack) navigation into the VS Code status bar. See where you are in a stack, identify the current pull request, and move between layers without leaving the editor.

<code>↓&nbsp; 2/4 · &#35;184 Add input validation &nbsp;↑</code>

## Highlights

- See the current stack position, pull request number, and title at a glance.
- Move to the previous or next reachable layer with one click.
- Open a Quick Pick to jump directly to any pull request in the stack.
- Preview the first few lines of the current pull request description in the tooltip.
- See concise `merged`, `queued`, and `needs rebase` status labels.
- Load a stack from the current pull request or from a pasted GitHub pull request URL.
- Enter a stack from trunk, including repositories with multiple local stacks.

## Getting started

1. Install [GitHub CLI](https://cli.github.com/) and authenticate:

   ```sh
   gh auth login
   ```

2. Install the GitHub stack extension:

   ```sh
   gh extension install github/gh-stack
   ```

3. Install StackNav, open a Git repository in VS Code, and check out a branch that belongs to a stack.

StackNav appears in the status bar when it finds a local stack. The built-in VS Code Git extension must be enabled.

## Using the status bar

The middle item shows your position and the current pull request:

<code>2/4 · &#35;184 Add input validation</code>

- Click the down or up arrow to move one reachable layer.
- Click the middle item to choose any layer from a Quick Pick.
- Hover over the middle item to preview the current pull request description.
- Hover over an arrow to see the next reachable pull request.

Merged layers are skipped when `gh-stack` would skip them. At the top or bottom of a stack, the unavailable arrow is hidden.

## Loading a stack

If the current branch has a pull request but no local stack, StackNav offers **Load stack for &#35;184**. This runs `gh stack checkout` for the pull request URL, fetches the stack branches, and may change the checked-out branch.

You can also run **StackNav: Load Stack from PR URL…** and paste a GitHub pull request link. Links to Files, Commits, and Checks tabs are accepted. StackNav verifies that the URL belongs to the selected local repository before loading it.

An ordinary pull request that is not part of a stack may produce an error. Open **Output**, then select **StackNav** to see the details.

## Using StackNav from trunk

When a stack is associated with the current trunk, StackNav stays visible and offers **Go to First Layer**. It enters the first unmerged layer.

If several local stacks share the same trunk, choose **Select stack…** to pick the stack you want. Canceling the picker leaves your checkout unchanged.

## Commands

| Command | Purpose |
| --- | --- |
| **StackNav: Load Stack for Current PR** | Load the stack for the pull request on the current branch. |
| **StackNav: Load Stack from PR URL…** | Load a stack from a pasted GitHub pull request link. |
| **StackNav: Up** | Move to the next reachable layer. |
| **StackNav: Down** | Move to the previous reachable layer. |
| **StackNav: Select PR…** | Choose a layer in the current stack. |
| **StackNav: Go to First Layer** | Enter the first unmerged layer from trunk. |
| **StackNav: Select Stack…** | Choose among local stacks that share the current trunk. |
| **StackNav: Select Repository…** | Choose which repository StackNav should use in a multi-repository workspace. |
| **StackNav: Refresh** | Reload stack and pull request information. |

## Requirements

- VS Code with the built-in Git extension enabled
- [GitHub CLI](https://cli.github.com/) authenticated for the repository
- [`github/gh-stack`](https://github.com/github/gh-stack) installed as a GitHub CLI extension
- A desktop or remote workspace extension host with access to `git` and `gh`

StackNav does not run in a browser extension host. In a workspace with multiple repositories, StackNav follows the repository of the active file and remembers the last repository when no file editor is open. You can also use **StackNav: Select Repository…** to choose one manually.

## Safety

StackNav reads stack and pull request information, then changes only your local checkout when you navigate or load a stack. It never runs `gh stack sync`, `push`, `submit`, or `rebase`. It also never stashes, resets, or forces a checkout.

Loading a remote stack uses `gh stack checkout`, which fetches branches and configures local tracking. If Git cannot safely carry your local changes to another branch, StackNav stops and reports the error.

## Troubleshooting

- Open **Output**, then select **StackNav** for command output and errors.
- If the repository has multiple remotes, configure the intended remote, for example with `git config remote.pushDefault origin`.
- If another local stack already tracks the same branches, resolve that conflict with `gh-stack` before loading the stack again.
- Run **StackNav: Refresh** to clear cached pull request titles and reload the current state.

## Development

```sh
npm install
npm test
```

Open the repository in VS Code and press **F5** to launch an Extension Development Host. Pull requests targeting `main` run the test suite. Every push to `main` also builds a versioned VSIX and publishes it under GitHub Releases.
