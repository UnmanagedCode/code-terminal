# code-terminal's integration installer, run on the target System through cc's
# POST /api/exec as `sh -c <this> sh <base> <hash> [<file> <content>]...`.
# An empty <base> means $HOME/.local/state/code-terminal. Prints shell=, home=
# and base= lines; any failure exits non-zero with the reason on stderr.
set -eu
umask 077
base=$1
hash=$2
shift 2
if [ -z "$base" ]; then
  base="${HOME:?HOME is not set on this System}/.local/state/code-terminal"
fi
mkdir -p "$base/shell" "$base/history"
dir="$base/shell/$hash"
if [ ! -f "$dir/.complete" ]; then
  tmp="$base/shell/.tmp.$$"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  while [ "$#" -ge 2 ]; do
    mkdir -p "$tmp/$(dirname "$1")"
    printf '%s' "$2" > "$tmp/$1"
    shift 2
  done
  : > "$tmp/.complete"
  # Another installer may have won the race; its copy is identical.
  mv "$tmp" "$dir" 2>/dev/null || rm -rf "$tmp"
fi
# The login shell as cc picks it: the passwd entry, then $SHELL, then /bin/sh.
shell=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7) || shell=
[ -n "$shell" ] || shell=${SHELL:-}
[ -n "$shell" ] || shell=/bin/sh
printf 'shell=%s\nhome=%s\nbase=%s\n' "$shell" "$HOME" "$base"
