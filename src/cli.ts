import { execFile } from 'node:child_process';

const executable = process.platform === 'win32' ? 'gh.exe' : 'gh';

export class CliError extends Error {
  constructor(message: string, readonly exitCode?: number, readonly missingExecutable = false) {
    super(message);
  }
}

type Runner = (args: readonly string[], cwd: string) => Promise<string>;

export class StackCli {
  constructor(private readonly runner: Runner = runGh) {}

  view(cwd: string): Promise<string> {
    return this.runner(['stack', 'view', '--json'], cwd);
  }

  currentPr(cwd: string): Promise<string> {
    return this.runner(['pr', 'view', '--json', 'number,url'], cwd);
  }

  load(cwd: string, prUrl: string): Promise<string> {
    if (!/^https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+$/.test(prUrl)) {
      throw new Error('Invalid PR URL');
    }
    return this.runner(['stack', 'checkout', prUrl], cwd);
  }

  move(cwd: string, direction: 'up' | 'down', steps = 1): Promise<string> {
    if (direction !== 'up' && direction !== 'down') { throw new Error('Invalid navigation direction'); }
    if (!Number.isSafeInteger(steps) || steps < 1) { throw new Error('Invalid step count'); }
    return this.runner(steps === 1 ? ['stack', direction] : ['stack', direction, String(steps)], cwd);
  }
}

function runGh(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, [...args], {
      cwd,
      timeout: args[1] === 'checkout' ? 120_000 : 30_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (!error) { resolve(stdout); return; }
      const failure = error as NodeJS.ErrnoException & { code?: string | number };
      const exitCode = typeof failure.code === 'number' ? failure.code : undefined;
      reject(new CliError((stderr || failure.message).trim(), exitCode, failure.code === 'ENOENT'));
    });
    // gh-stack cannot wait for input from this extension's background process.
    child.stdin?.end();
  });
}
