# code-terminal: zsh runs as `zsh -l` with ZDOTDIR on this directory. Each
# wrapper sources the user's own file, from their ZDOTDIR (their .zshenv may set
# one) or $HOME, then points ZDOTDIR back here for the next startup file.
CODE_TERMINAL_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$HOME
[[ -r $ZDOTDIR/.zshenv ]] && source $ZDOTDIR/.zshenv
CODE_TERMINAL_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$CODE_TERMINAL_ZDOTDIR
