#!/usr/bin/env bash
# Symlink the main checkout's out-of-tree .wiki into this worktree.
#
# Run by code-conductor after creating a worktree, with cwd in the new
# worktree. CC_PARENT_PATH is the main checkout's absolute path.

set -e

if [ -e .wiki ] || [ -L .wiki ]; then
    echo "[post-worktree-create] .wiki already exists - skipping symlink."
elif [ -z "${CC_PARENT_PATH}" ]; then
    echo "[post-worktree-create] WARNING: CC_PARENT_PATH unset; skipping .wiki symlink." >&2
elif [ ! -d "${CC_PARENT_PATH}/.wiki" ]; then
    echo "[post-worktree-create] WARNING: ${CC_PARENT_PATH}/.wiki not found; skipping .wiki symlink." >&2
else
    ln -s "${CC_PARENT_PATH}/.wiki" .wiki
fi
