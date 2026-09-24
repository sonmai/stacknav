import * as vscode from 'vscode';
import { relative, isAbsolute, sep } from 'node:path';
import { CliError, RepositoryMismatchError, StackCli } from './cli';
import { NavState, navigation, normalizePrUrl, parseCurrentPr, parseStack, prLabel, prSummary, StackBranch, StackView } from './core';
import { PrTitles } from './prTitles';

interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD: { name?: string; commit?: string } | undefined;
    onDidChange: vscode.Event<void>;
  };
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
  const titles = new PrTitles(async (root, url) => {
    try { return await cli.prTitle(root, url); }
    catch (error) { output.appendLine(`PR title lookup: ${String(error)}`); throw error; }
  });
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
  const observedHeads = new Map<GitRepository, string>();
  let state: NavState = { type: 'empty' };
  let stateRoot: string | undefined;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let selectedRepository: GitRepository | undefined;
  let updatePicker: (() => void) | undefined;
  let disposed = false;

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
    return api.repositories.length === 1 ? api.repositories[0]
      : selectedRepository && api.repositories.includes(selectedRepository) ? selectedRepository : undefined;
  }

  function hide(): void {
    down.hide();
    center.hide();
    up.hide();
  }

  function details(branch: StackBranch | undefined): string {
    if (!branch) { return '—'; }
    const title = branch.pr && titles.peek(branch.pr.url);
    return `${prSummary(branch, title)}${title ? `\n${branch.name}` : ''}`;
  }

  async function loadTitles(stack: StackView, root: string, ticket: number): Promise<void> {
    const prs = stack.branches.flatMap(branch => branch.pr ? [branch.pr] : []);
    for (let i = 0; i < prs.length && !disposed && ticket === generation; i += 4) {
      const batch = prs.slice(i, i + 4);
      const before = batch.map(pr => titles.peek(pr.url));
      await Promise.all(batch.map(pr => titles.get(root, pr.url)));
      const changed = batch.some((pr, index) => titles.peek(pr.url) !== before[index]);
      if (changed && !disposed && ticket === generation && stateRoot === root) {
        render();
        updatePicker?.();
      }
    }
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
    const targets = navigation(stack, index);
    center.text = `$(layers) ${index + 1}/${stack.branches.length} · ${prLabel(current)}`;
    center.tooltip = [
      `StackNav · ${index + 1} of ${stack.branches.length}`,
      `Current: ${details(current)}${current.isMerged ? ' (merged)' : ''}`,
      `Above: ${details(targets.above === undefined ? undefined : stack.branches[targets.above])}`,
      `Below: ${details(targets.below === undefined ? undefined : stack.branches[targets.below])}`,
      `Trunk: ${stack.trunk}`
    ].join('\n');
    center.command = 'stacknav.select';
    center.show();
    if (targets.below !== undefined) {
      down.text = '$(arrow-down)';
      down.tooltip = `Previous: ${details(stack.branches[targets.below])}`;
      down.show();
    }
    if (targets.above !== undefined) {
      up.text = '$(arrow-up)';
      up.tooltip = `Next: ${details(stack.branches[targets.above])}`;
      up.show();
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) { return; }
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
      if (next.type === 'loaded') { void loadTitles(next.stack, root, ticket); }
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
          : error instanceof CliError && error.exitCode === 6
            ? 'This branch belongs to several stacks. Check out a PR branch unique to the stack, then refresh.'
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
    const headKey = () => `${repo.state.HEAD?.name ?? ''}\0${repo.state.HEAD?.commit ?? ''}`;
    observedHeads.set(repo, headKey());
    repositoryListeners.set(repo, repo.state.onDidChange(() => {
      const next = headKey();
      if (next === observedHeads.get(repo)) { return; }
      observedHeads.set(repo, next);
      if (!busy) { scheduleRefresh(); }
    }));
  }

  if (api) {
    for (const repo of api.repositories) { observe(repo); }
    context.subscriptions.push(api.onDidOpenRepository(repo => { observe(repo); scheduleRefresh(); }));
    context.subscriptions.push(api.onDidCloseRepository(repo => {
      repositoryListeners.get(repo)?.dispose();
      repositoryListeners.delete(repo);
      observedHeads.delete(repo);
      scheduleRefresh();
    }));
  }
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
    if (activeRepository()?.rootUri.fsPath !== stateRoot) { scheduleRefresh(); }
  }));
  context.subscriptions.push({ dispose: () => {
    disposed = true;
    ++generation;
    if (timer) { clearTimeout(timer); }
    for (const listener of repositoryListeners.values()) { listener.dispose(); }
  } });

  function currentRoot(): string | undefined {
    const root = activeRepository()?.rootUri.fsPath;
    return root && root === stateRoot ? root : undefined;
  }

  async function perform(label: string, action: (root: string) => Promise<string>, showProgress = false, explicitRoot?: string): Promise<void> {
    if (busy) { return; }
    const root = explicitRoot ?? currentRoot();
    if (!root) { await refresh(); return; }
    busy = true;
    let failure: unknown;
    try {
      output.appendLine(`${label} in ${root}`);
      if (showProgress) {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'StackNav: Loading stack for review…',
          cancellable: false
        }, () => action(root));
      } else {
        await action(root);
      }
    } catch (error) {
      output.appendLine(`${label}: ${String(error)}`);
      failure = error;
    } finally {
      await refresh();
      busy = false;
    }
    if (failure) {
      const detail = failure instanceof RepositoryMismatchError ? failure.message
        : failure instanceof CliError && /different composition|already tracked/i.test(failure.message)
        ? 'The local stack has a different composition. Resolve that conflict manually before loading.'
        : failure instanceof CliError && /remote\.pushDefault|multiple remotes|choose.*remote/i.test(failure.message)
          ? 'Set Git remote.pushDefault for this repository, then try again.'
          : 'See Output for details.';
      const choice = await vscode.window.showErrorMessage(`StackNav: ${label} failed. ${detail}`, 'Show Output');
      if (choice) { output.show(true); }
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('stacknav.refresh', () => { titles.clear(); return refresh(); }),
    vscode.commands.registerCommand('stacknav.loadUrl', async () => {
      if (busy) { return; }
      let repo = activeRepository();
      if (!repo && api?.repositories.length) {
        const chosen = await vscode.window.showQuickPick(api.repositories.map(repository => ({
          label: repository.rootUri.fsPath, repository
        })), { placeHolder: 'Choose the local repository for this PR stack' });
        if (!chosen) { return; }
        repo = chosen.repository;
        selectedRepository = repo;
      }
      if (!repo) { vscode.window.showInformationMessage('StackNav: Open a local Git repository first.'); return; }
      const root = repo.rootUri.fsPath;
      const input = await vscode.window.showInputBox({
        title: 'Load Stack from PR URL',
        prompt: `Fetch and check out the PR stack in ${root}`,
        placeHolder: 'https://github.com/owner/repo/pull/184',
        validateInput: value => {
          try { normalizePrUrl(value); return undefined; }
          catch (error) { return (error as Error).message; }
        }
      });
      if (input === undefined) { return; }
      await perform('Load stack', cwd => cli.load(cwd, normalizePrUrl(input)), true, root);
    }),
    vscode.commands.registerCommand('stacknav.load', async () => {
      if (state.type !== 'unloaded') { return; }
      const url = state.pr.url;
      await perform('Load stack', root => cli.load(root, url), true);
    }),
    vscode.commands.registerCommand('stacknav.up', async () => {
      if (state.type === 'loaded' && navigation(state.stack, state.index).above !== undefined) {
        await perform('Move up', root => cli.move(root, 'up'));
      }
    }),
    vscode.commands.registerCommand('stacknav.down', async () => {
      if (state.type === 'loaded' && navigation(state.stack, state.index).below !== undefined) {
        await perform('Move down', root => cli.move(root, 'down'));
      }
    }),
    vscode.commands.registerCommand('stacknav.select', async () => {
      if (state.type !== 'loaded') { return; }
      const stack = state.stack;
      const targets = navigation(stack, state.index);
      if (busy || updatePicker) { return; }
      const pickerRoot = currentRoot();
      const items = () => [...targets.selectable].reverse().map(index => {
          const branch = stack.branches[index];
          return {
            index,
            branch,
            label: `${branch.isCurrent ? '$(check)' : '$(circle-outline)'} ${prSummary(branch, branch.pr && titles.peek(branch.pr.url))}`,
            description: `${index + 1}/${stack.branches.length}${branch.isCurrent ? ' · Current' : ''}`,
            detail: branch.name
          };
        });
      const picker = vscode.window.createQuickPick<ReturnType<typeof items>[number]>();
      picker.placeholder = `Select a PR layer · trunk: ${stack.trunk}`;
      picker.matchOnDetail = true;
      picker.items = items();
      updatePicker = () => {
        const focused = picker.activeItems[0]?.index;
        picker.items = items();
        const active = picker.items.find(item => item.index === focused);
        if (active) { picker.activeItems = [active]; }
      };
      const selected = await new Promise<ReturnType<typeof items>[number] | undefined>(resolve => {
        const accepted = picker.onDidAccept(() => { resolve(picker.selectedItems[0]); picker.hide(); });
        const hidden = picker.onDidHide(() => {
          resolve(undefined); accepted.dispose(); hidden.dispose(); picker.dispose(); updatePicker = undefined;
        });
        picker.show();
      });
      if (selected && !selected.branch.isCurrent) {
        await refresh();
        if (currentRoot() !== pickerRoot || state.type !== 'loaded' || state.stack.currentBranch !== stack.currentBranch ||
            state.stack.branches.length !== stack.branches.length ||
            state.stack.branches.some((branch, index) =>
              branch.name !== stack.branches[index].name || branch.isMerged !== stack.branches[index].isMerged)) {
          vscode.window.showInformationMessage('StackNav: The stack changed. Select the PR again.');
          return;
        }
        const move = navigation(state.stack, state.index).moveTo(selected.index);
        if (move) {
          await perform('Switch PR', root => cli.move(root, move.direction, move.steps));
        }
      }
    })
  );

  void refresh();
}

export function deactivate(): void { /* Disposables are owned by the extension context. */ }
