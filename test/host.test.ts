import assert from 'node:assert/strict';
import test from 'node:test';
import { StackCli } from '../src/cli';

function event() {
  const listeners = new Set<(...args: any[]) => void>();
  return {
    subscribe: (listener: (...args: any[]) => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
    fire: (...args: any[]) => { for (const listener of listeners) { listener(...args); } },
    get size() { return listeners.size; }
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('host retains busy HEAD changes, replaces listeners, cancels stale reads and exposes trunk entry', async () => {
  const changedA = event(), changedB = event(), opened = event(), closed = event(), editorChanged = event();
  const repo = (root: string, changed: ReturnType<typeof event>) => ({ rootUri: { fsPath: root }, state: { HEAD: { name: 'main', commit: '1' }, onDidChange: changed.subscribe } });
  const a = repo('/a', changedA), b = repo('/b', changedB);
  const api = { repositories: [a, b], onDidOpenRepository: opened.subscribe, onDidCloseRepository: closed.subscribe };
  const commands = new Map<string, (...args: any[]) => any>();
  const bars: any[] = [];
  const window: any = {
    activeTextEditor: { document: { uri: { scheme: 'file', fsPath: '/a/file' } } },
    onDidChangeActiveTextEditor: editorChanged.subscribe,
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    createStatusBarItem: () => { const bar = { visible: false, show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {} }; bars.push(bar); return bar; },
    showWarningMessage() {}, showErrorMessage() {}, showInformationMessage() {}
  };
  const vscode = {
    window, StatusBarAlignment: { Left: 1 },
    commands: { registerCommand: (name: string, fn: (...args: any[]) => any) => { commands.set(name, fn); return { dispose() {} }; } },
    extensions: { getExtension: () => ({ activate: async () => ({ enabled: true, getAPI: () => api }) }) }
  };
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function(id: string, ...args: any[]) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
  const { activate } = require('../src/extension');
  Module._load = originalLoad;
  const subscriptions: { dispose(): void }[] = [];
  const originalView = StackCli.prototype.view, originalDetails = StackCli.prototype.prDetails, originalFirst = StackCli.prototype.firstLayer;
  const calls: string[] = [], signals: AbortSignal[] = [];
  let holdRead = false;
  let allMerged = false;
  const detailCalls: { url: string; body: boolean }[] = [];
  let finishMove: (() => void) | undefined;
  const payload = (root: string) => JSON.stringify({ trunk: 'main', currentBranch: root === '/a' ? 'main' : 'feature', branches: [
    { name: 'merged', isCurrent: false, isMerged: true, pr: { number: 1, url: 'https://github.com/o/r/pull/1', state: 'MERGED' } },
    { name: 'feature', isCurrent: root === '/b', isMerged: allMerged, isQueued: true, needsRebase: true, pr: { number: 2, url: 'https://github.com/o/r/pull/2', state: 'OPEN' } }
  ] });
  StackCli.prototype.view = async (root, signal) => {
    calls.push(root); signals.push(signal!);
    if (holdRead) { return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason))); }
    return payload(root);
  };
  StackCli.prototype.prDetails = async (_root, url, body = true) => { detailCalls.push({ url, body }); return { title: 'PR', ...(body ? { body: 'Preview' } : {}) }; };
  StackCli.prototype.firstLayer = async () => new Promise(resolve => { finishMove = () => resolve('ok'); });
  try {
    await activate({ subscriptions }); await tick();
    assert.equal(bars[1].text, '$(layers) Trunk');
    assert.ok(detailCalls.every(call => !call.body));
    assert.equal(bars[2].command, 'stacknav.first');
    assert.equal(changedA.size, 1);
    opened.fire(a); opened.fire(a);
    assert.equal(changedA.size, 1);
    const moving = commands.get('stacknav.first')!();
    assert.ok(finishMove);
    window.activeTextEditor.document.uri.fsPath = '/b/file';
    b.state.HEAD.commit = '2'; changedB.fire(); editorChanged.fire();
    finishMove!(); await moving;
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(calls.at(-1), '/b');
    assert.match(bars[1].text, /queued · needs rebase/);
    assert.deepEqual(detailCalls.filter(call => call.body).map(call => call.url), ['https://github.com/o/r/pull/2']);
    assert.equal(bars[2].command, 'stacknav.up');
    holdRead = true;
    const stale = commands.get('stacknav.refresh')!(); await tick();
    const staleSignal = signals.at(-1)!;
    window.activeTextEditor.document.uri.fsPath = '/a/file';
    editorChanged.fire();
    assert.ok(staleSignal.aborted);
    await stale;
    holdRead = false;
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(calls.at(-1), '/a');
    allMerged = true;
    await commands.get('stacknav.refresh')!(); await tick();
    assert.equal(bars[2].visible, false);
    assert.equal(bars[1].command, undefined);
  } finally {
    for (const subscription of subscriptions) { subscription.dispose(); }
    StackCli.prototype.view = originalView; StackCli.prototype.prDetails = originalDetails; StackCli.prototype.firstLayer = originalFirst;
  }
  assert.equal(changedA.size, 0); assert.equal(changedB.size, 0);
});
