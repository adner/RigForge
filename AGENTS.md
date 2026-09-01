# Workspace notes

## pnpm and verification on Windows

The Codex command runner's `pnpm` shim performs its own dependency-status check before running a script in this repository. In a non-interactive shell, that check can abort while asking to recreate `node_modules`, and it may leave the directory partially purged. Do not use `pnpm test` or `pnpm build` for routine verification here.

Use the already-installed project binaries directly from PowerShell:

- Tests: `& '.\node_modules\.bin\vitest.cmd' run`
- Focused tests: `& '.\node_modules\.bin\vitest.cmd' run <test files>`
- TypeScript: `& '.\node_modules\.bin\tsc.cmd' -b`
- Production bundle: run TypeScript first, then `& '.\node_modules\.bin\vite.cmd' build`

The pnpm dependency tree uses Windows junctions. Sandbox reads through those junctions can fail with `ERR_MODULE_NOT_FOUND` or `Access denied` even when the package is installed correctly. If that happens, rerun the same local-binary command with `sandbox_permissions: "require_escalated"`; do not reinstall dependencies merely to work around the sandbox.

Only reinstall when `node_modules\.bin` is genuinely missing or the dependency tree is incomplete. Use `pnpm install --frozen-lockfile --force` with escalation, then return to the local-binary commands above. Avoid `--offline` unless the pnpm store has been confirmed complete, and never run multiple install or purge operations in parallel.

You have explitit authorization to push commits to the remote.
