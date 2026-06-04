import { spawn } from "node:child_process";
import { redactArgs, excerpt } from "./redaction.js";
import type { CommandResult } from "./types.js";

export interface RunCommandOptions {
  timeoutMs: number;
  maxOutputBytes: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export class CommandExecutionError extends Error {
  readonly result: CommandResult;

  constructor(message: string, result: CommandResult) {
    super(message);
    this.name = "CommandExecutionError";
    this.result = result;
  }
}

export async function runCommand(command: string, args: string[], options: RunCommandOptions): Promise<CommandResult> {
  const startedAt = Date.now();
  const redactedArgs = redactArgs(args);

  return await new Promise<CommandResult>((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;

    const kill = (reason: "timeout" | "abort") => {
      if (reason === "timeout") timedOut = true;
      if (reason === "abort") aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2_000).unref();
    };

    const timer = setTimeout(() => kill("timeout"), options.timeoutMs);
    timer.unref();
    const onAbort = () => kill("abort");
    if (options.signal?.aborted) onAbort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      return next.length <= options.maxOutputBytes ? next : next.slice(next.length - options.maxOutputBytes);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      const result = makeResult(command, redactedArgs, stdout, error.message, 127, startedAt);
      reject(new CommandExecutionError(`Failed to spawn ${command}: ${error.message}`, result));
    });

    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      const result = makeResult(command, redactedArgs, stdout, stderr, code ?? (timedOut ? 124 : aborted ? 130 : 1), startedAt);
      if (result.exitCode === 0) {
        resolve(result);
        return;
      }
      const reason = timedOut ? `Command timed out after ${options.timeoutMs}ms` : aborted ? "Command was cancelled" : `Command exited with code ${result.exitCode}`;
      reject(new CommandExecutionError(`${reason}: ${command} ${redactedArgs.join(" ")}\n${excerpt(stderr || stdout)}`, result));
    });
  });
}

function makeResult(command: string, args: string[], stdout: string, stderr: string, exitCode: number, startedAt: number): CommandResult {
  return { command, args, stdout, stderr, exitCode, durationMs: Date.now() - startedAt };
}
