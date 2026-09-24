import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runGit } from './cli';

export interface LocalStack {
  key: string;
  number?: number;
  trunk: string;
  branches: { name: string; merged: boolean; prNumber?: number }[];
}

export function parseLocalStacks(json: string, trunk: string): LocalStack[] {
  const data = JSON.parse(json);
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.stacks)) {
    throw new Error('Unsupported gh-stack metadata. Update gh-stack or select a PR branch manually.');
  }
  return data.stacks.filter((stack: any) => stack?.trunk?.branch === trunk).map((stack: any) => {
    if (!Array.isArray(stack.branches) || stack.branches.some((b: any) => !b || typeof b.branch !== 'string' || !b.branch)) {
      throw new Error('Invalid local stack branches');
    }
    const branches = stack.branches.map((b: any) => ({
      name: b.branch, merged: b.pullRequest?.merged === true,
      prNumber: Number.isSafeInteger(b.pullRequest?.number) ? b.pullRequest.number : undefined
    }));
    return {
      key: JSON.stringify([stack.id ?? null, stack.number ?? null, trunk, branches]),
      number: Number.isSafeInteger(stack.number) && stack.number > 0 ? stack.number : undefined,
      trunk, branches
    };
  });
}

export class LocalStacks {
  constructor(private readonly git = runGit,
    private readonly read = (path: string, signal?: AbortSignal) => readFile(path, { encoding: 'utf8', signal })) {}

  async list(root: string, signal?: AbortSignal): Promise<LocalStack[]> {
    const branch = (await this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root, signal)).trim();
    const dir = (await this.git(['rev-parse', '--absolute-git-dir'], root, signal)).trim();
    const json = await this.read(resolve(dir, 'gh-stack'), signal);
    return parseLocalStacks(json, branch);
  }

  async enter(root: string, selected: LocalStack): Promise<string> {
    const choices = await this.list(root);
    const current = choices.find(stack => stack.key === selected.key);
    const target = current?.branches.find(branch => !branch.merged);
    if (!target) { throw new Error('The stack or current branch changed. Select the stack again.'); }
    // --no-guess forbids silently creating a tracking branch from a remote.
    return this.git(['switch', '--no-guess', '--', target.name], root);
  }
}
