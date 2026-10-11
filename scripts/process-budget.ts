/**
 * The timeout of a test that starts processes (bash, git, Node, zip, ffmpeg), for its `describe`.
 * Vitest's default 5 s is sized for code: a process start costs tens of milliseconds on Linux, but
 * it can stall for seconds on a busy runner, and on Windows one Git Bash start took 6.4 s while
 * other test files started processes beside it. Unit tests keep the 5 s, which keeps a CPU-bound
 * regression in them visible.
 */
export const PROCESS_BUDGET_MS = 20_000;
