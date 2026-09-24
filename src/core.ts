export interface StackBranch {
  name: string;
  isCurrent: boolean;
  isMerged: boolean;
  isQueued: boolean;
  needsRebase: boolean;
  pr?: { number: number; url: string; state: string };
}

export interface StackView {
  trunk: string;
  currentBranch: string;
  branches: StackBranch[];
}

export interface CurrentPr {
  number: number;
  url: string;
}

export type NavState =
  | { type: 'empty' }
  | { type: 'error'; message: string }
  | { type: 'unloaded'; pr: CurrentPr }
  | { type: 'loaded'; stack: StackView; index: number };

export function parseStack(json: string): NavState {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || typeof value.trunk !== 'string' ||
      typeof value.currentBranch !== 'string' || !Array.isArray(value.branches)) {
    throw new Error('Unexpected gh stack view JSON format');
  }

  const branches: StackBranch[] = value.branches.map((raw: unknown) => {
    if (!isRecord(raw) || typeof raw.name !== 'string' || typeof raw.isCurrent !== 'boolean') {
      throw new Error('Unexpected gh stack branch format');
    }
    const pr = isRecord(raw.pr) && Number.isInteger(raw.pr.number) &&
      typeof raw.pr.url === 'string' && typeof raw.pr.state === 'string'
      ? { number: raw.pr.number as number, url: raw.pr.url, state: raw.pr.state }
      : undefined;
    return {
      name: raw.name,
      isCurrent: raw.isCurrent,
      isMerged: raw.isMerged === true,
      isQueued: raw.isQueued === true,
      needsRebase: raw.needsRebase === true,
      pr
    };
  });
  const index = branches.findIndex(branch => branch.isCurrent);
  // A trunk checkout is not a PR layer. There is no meaningful current position.
  if (index < 0) { return { type: 'empty' }; }
  return { type: 'loaded', stack: { trunk: value.trunk, currentBranch: value.currentBranch, branches }, index };
}

export function parseCurrentPr(json: string): CurrentPr {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || !Number.isInteger(value.number) ||
      (value.number as number) <= 0 || typeof value.url !== 'string' ||
      !/^https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+$/.test(value.url)) {
    throw new Error('Unexpected gh pr view JSON format');
  }
  return { number: value.number as number, url: value.url };
}

export function prLabel(branch: StackBranch): string {
  return branch.pr ? `#${branch.pr.number}` : 'No PR';
}

/** gh-stack skips merged layers when navigating from an active branch.
 * When already on a merged branch, it counts every layer instead. */
export function navigation(stack: StackView, index: number): {
  selectable: number[];
  above?: number;
  below?: number;
  moveTo(targetIndex: number): { direction: 'up' | 'down'; steps: number } | undefined;
} {
  const selectable = stack.branches[index]?.isMerged
    ? stack.branches.map((_, i) => i)
    : stack.branches.flatMap((branch, i) => branch.isMerged ? [] : [i]);
  const position = selectable.indexOf(index);
  return {
    selectable,
    above: selectable[position + 1],
    below: selectable[position - 1],
    moveTo(targetIndex) {
      const targetPosition = selectable.indexOf(targetIndex);
      if (position < 0 || targetPosition < 0 || targetPosition === position) { return undefined; }
      return {
        direction: targetPosition > position ? 'up' : 'down',
        steps: Math.abs(targetPosition - position)
      };
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
