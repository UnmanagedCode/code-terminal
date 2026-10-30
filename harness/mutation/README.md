# Mutation harness

Driven by the shared code-mutant runner; this directory holds only `config.json`.

## Invocation

Run from the project root:

```bash
node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" <command>
```

A shell that cc did not spawn must first `export CC_PROJECTS_ROOT=<absolute projects root>`.
Commands and flags: `node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" --help`.
Mutant catalog format: `mutants.schema.md` in the code-mutant plugin. The catalog (`.mutation/mutants.json`) is not committed.

## Config

- `isolation`: `in-place`; `baseBranch`: `main`.
- Routes, each scoped to its runner's test discovery:

| Route | Runner | Tests |
|---|---|---|
| `backend` | `node-test` | `tests/**/*.test.mjs` |
| `frontend` | `vitest` | `frontend/src/**/*.test.ts`, `frontend/src/**/*.test.tsx` |

- The baseline needs a clean, committed tree (`.mutation/` is git-ignored).
