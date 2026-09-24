import * as vscode from 'vscode';
import { relative, isAbsolute, sep } from 'node:path';
import { CliError, StackCli } from './cli';
import { NavState, parseCurrentPr, parseStack, prLabel, StackBranch } from './core';

interface GitRepository {
  rootUri: vscode.Uri;
  state: { onDidChange: vscode.Event<void> };
}

interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('StackNav');
  const cli = new StackCli();
  const down = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
  const center = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  const up = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  down.command = 'stacknav.down';
  center.command = 'stacknav.select';
  up.command = 'stacknav.up';
  context.subscriptions.push(output, down, center, up);

  const git = await vscode.extensions.getExtension<GitExtension>('vscode.git')?.activate();
  const api = git?.getAPI(1);
  const repositoryListeners = new Map<GitRepository, vscode.Disposable>();
  let state: NavState = { type: 'empty' };
  let stateRoot: string | undefined;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;

  function activeRepository(): GitRepository | undefined {
    if (!api) { return undefined; }
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.scheme === 'file') {
      const path = editor.document.uri.fsPath;
      const candidates = api.repositories.filter(repo => {
        const child = relative(repo.rootUri.fsPath, path);
        return child === '' || (child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child));
      });
      if (candidates.length) {
        return candidates.sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
      }
    }
    return api.repositories.length === 1 ? api.repositories[0] : undefined;
  }

  function hide(): void {
    down.hide();
    center.hide();
    up.hide();
  }

  function details(branch: StackBranch | undefined): string {
    return branch ? `${prLabel(branch)} · ${branch.name}` : '—';
  }

  function render(): void {
    hide();
    if (state.type === 'empty') { return; }
    if (state.type === 'error') {
      center.text = '$(warning) StackNav';
      center.tooltip = state.message;
      center.command = 'stacknav.refresh';
      center.show();
      return;
    }
    if (state.type === 'unloaded') {
      center.text = `$(layers) Load stack for #${state.pr.number}`;
      center.tooltip = 'Fetch this PR’s stack locally for review. No remote branches or PRs are changed.';
      center.command = 'stacknav.load';
      center.show();
      return;
    }
    const { stack, index } = state;
    const current = stack.branches[index];
    center.text = `$(layers) ${index + 1}/${stack.branches.length} · ${prLabel(current)}`;
    center.tooltip = [
      `StackNav · ${index + 1} of ${stack.branches.length}`,
      `Current: ${details(current)}`,
      `Above: ${details(stack.branches[index + 1])}`,
      `Below: ${details(stack.branches[index - 1])}`,
      `Trunk: ${stack.trunk}`
    ].join('\n');
    center.command = 'stacknav.select';
    center.show();
    if (index > 0) {
      down.text = '$(arrow-down)';
      down.tooltip = `Down to ${details(stack.branches[index - 1])}`;
      down.show();
    }
    if (index < stack.branches.length - 1) {
      up.text = '$(arrow-up)';
      up.tooltip = `Up to ${details(stack.branches[index + 1])}`;
      up.show();
    }
  }

  async function refresh(): Promise<void> {
    const ticket = ++generation;
    const repo = activeRepository();
    const root = repo?.rootUri.fsPath;
    if (!root) {
      state = { type: 'empty' };
      stateRoot = undefined;
      render();
      return;
    }
    try {
      const json = await cli.view(root);
      const next = parseStack(json);
      if (ticket !== generation) { return; }
      state = next;
      stateRoot = root;
      render();
    } catch (error) {
      if (ticket !== generation) { return; }
      if (error instanceof CliError && error.exitCode === 2) {
        try {
          const pr = parseCurrentPr(await cli.currentPr(root));
          if (ticket !== generation) { return; }
          state = { type: 'unloaded', pr };
        } catch (prError) {
          output.appendLine(`PR lookup: ${String(prError)}`);
          if (ticket !== generation) { return; }
          state = { type: 'empty' };
        }
      } else {
        output.appendLine(`Stack view: ${String(error)}`);
        state = { type: 'error', message: error instanceof CliError && error.missingExecutable
          ? 'GitHub CLI (gh) was not found. Install it and click to retry.'
          : 'Could not read the stack. Check Output → StackNav; click to retry.' };
      }
      stateRoot = root;
      render();
    }
  }

  function scheduleRefresh(): void {
    if (timer) { clearTimeout(timer); }
    timer = setTimeout(() => { timer = undefined; void refresh(); }, 250);
  }

  function observe(repo: GitRepository): void {
    repositoryListeners.set(repo, repo.state.onDidChange(scheduleRefresh));
  }

  if (api) {
    for (const repo of api.repositories) { observe(repo); }
    context.subscriptions.push(api.onDidOpenRepository(repo => { observe(repo); scheduleRefresh(); }));
    context.subscriptions.push(api.onDidCloseRepository(repo => {
      repositoryListeners.get(repo)?.dispose();
      repositoryListeners.delete(repo);
      scheduleRefresh();
    }));
  }
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(scheduleRefresh));
  context.subscriptions.push({ dispose: () => {
    if (timer) { clearTimeout(timer); }
    for (const listener of repositoryListeners.values()) { listener.dispose(); }
  } });

  function currentRoot(): string | undefined {
    const root = activeRepository()?.rootUri.fsPath;
    return root && root === stateRoot ? root : undefined;
  }

  async function perform(label: string, action: (root: string) => Promise<string>): Promise<void> {
    if (busy) { return; }
    const root = currentRoot();
    if (!root) { await refresh(); return; }
    busy = true;
    try {
      output.appendLine(`${label} in ${root}`);
      await action(root);
      await refresh();
    } catch (error) {
      output.appendLine(`${label}: ${String(error)}`);
      const choice = await vscode.window.showErrorMessage(`StackNav: ${label} failed. See Output for details.`, 'Show Output');
      if (choice) { output.show(true); }
      await refresh();
    } finally {
      busy = false;
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('stacknav.refresh', refresh),
    vscode.commands.registerCommand('stacknav.load', async () => {
      if (state.type !== 'unloaded') { return; }
      const url = state.pr.url;
      await perform('Load stack', root => cli.load(root, url));
    }),
    vscode.commands.registerCommand('stacknav.up', async () => {
      if (state.type === 'loaded' && state.index < state.stack.branches.length - 1) {
        await perform('Move up', root => cli.move(root, 'up'));
      }
    }),
    vscode.commands.registerCommand('stacknav.down', async () => {
      if (state.type === 'loaded' && state.index > 0) {
        await perform('Move down', root => cli.move(root, 'down'));
      }
    }),
    vscode.commands.registerCommand('stacknav.select', async () => {
      if (state.type !== 'loaded') { return; }
      const stack = state.stack;
      const selected = await vscode.window.showQuickPick(
        [...stack.branches].reverse().map(branch => ({
          label: `${branch.isCurrent ? '$(check)' : '$(circle-outline)'} ${prLabel(branch)} · ${branch.name}`,
          description: branch.isCurrent ? 'Current' : undefined,
          branch
        })),
        { placeHolder: `Select a PR layer · trunk: ${stack.trunk}` }
      );
      if (selected && !selected.branch.isCurrent) {
        await refresh();
        if (state.type !== 'loaded' || state.stack.currentBranch !== stack.currentBranch ||
            state.stack.branches.length !== stack.branches.length ||
            state.stack.branches.some((branch, index) => branch.name !== stack.branches[index].name)) {
          vscode.window.showInformationMessage('StackNav: The stack changed. Select the PR again.');
          return;
        }
        const targetIndex = state.stack.branches.findIndex(branch => branch.name === selected.branch.name);
        const steps = Math.abs(targetIndex - state.index);
        if (steps > 0) {
          const direction = targetIndex > state.index ? 'up' : 'down';
          await perform('Switch PR', root => cli.move(root, direction, steps));
        }
      }
    })
  );

  await refresh();
}

export function deactivate(): void { /* Disposables are owned by the extension context. */ }
