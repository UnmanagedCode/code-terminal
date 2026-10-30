# code-terminal: see .zshenv. The last startup file: after the user's .zlogin it
# pins history to the project's file and gives ZDOTDIR back to the user. zsh
# reads the history file after this.
ZDOTDIR=$CODE_TERMINAL_USER_ZDOTDIR
[[ -r $ZDOTDIR/.zlogin ]] && source $ZDOTDIR/.zlogin
HISTFILE=$CODE_TERMINAL_HISTFILE
export HISTFILE
(( ${SAVEHIST:-0} > 0 )) || SAVEHIST=10000
(( ${HISTSIZE:-0} > 0 )) || HISTSIZE=10000
setopt SHARE_HISTORY
if [[ $ZDOTDIR == $HOME ]]; then unset ZDOTDIR; fi
unset CODE_TERMINAL_ZDOTDIR CODE_TERMINAL_USER_ZDOTDIR
