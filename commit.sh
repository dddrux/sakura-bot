#!/usr/bin/env bash
# Commit seguro da Sakura-BOT.
#   ./commit.sh "patchX.Y: resumo"      commit + pergunta se envia (push)
#   ./commit.sh -y "mensagem"           sem perguntas
#   ./commit.sh -n "mensagem"           só commit, sem push
#   npm run commit -- "mensagem"
set -u
cd "$(dirname "$0")" || exit 1

yes=0; push=1; msg=""
for a in "$@"; do
  case "$a" in
    -y|--sim) yes=1 ;;
    -n|--sem-push) push=0 ;;
    *) msg="$a" ;;
  esac
done

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Aqui não é um repositório git."; exit 1; }
git config user.name >/dev/null && git config user.email >/dev/null || {
  echo 'Configure antes: git config --global user.name "Seu Nome" && git config --global user.email "voce@email.com"'; exit 1; }

ask() { [ "$yes" = 1 ] && return 0; read -r -p "$1 [S/n] " r; [[ -z "$r" || "$r" =~ ^[sSyY] ]]; }

# nunca entram no commit, mesmo fora do .gitignore
git add -A -- . ':(exclude)auth' ':(exclude)config/private' ':(exclude)backup' ':(exclude)storage' \
  ':(exclude).env' ':(exclude).env.*' ':(exclude)node_modules' ':(exclude)*.zip' ':(exclude)*.log'

if git diff --cached --quiet; then echo "Nada para commitar."; exit 0; fi

# trava de segurança: segredos já rastreados
if git diff --cached --name-only | grep -Eq '^(auth/|config/private/|backup/|storage/|\.env)'; then
  echo "ABORTADO: há arquivo secreto na área de commit:"
  git diff --cached --name-only | grep -E '^(auth/|config/private/|backup/|storage/|\.env)'
  echo "Remova com: git rm --cached -r <caminho>"
  git reset -q; exit 1
fi

echo "Arquivos no commit:"; git status -s
if [ -z "$msg" ]; then read -r -p "Mensagem do commit: " msg; fi
[ -n "$msg" ] || { echo "Mensagem vazia."; git reset -q; exit 1; }

ask "Confirmar commit?" || { git reset -q; echo "Cancelado."; exit 0; }
git commit -q -m "$msg" || exit 1
echo "Commit feito: $(git log --oneline -1)"

[ "$push" = 1 ] || exit 0
ask "Enviar para o GitHub (push)?" || { echo "Commit local feito. Envie depois com: git push"; exit 0; }

branch=$(git branch --show-current)
doPush() { if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then git push; else git push -u origin "$branch"; fi; }
if ! doPush; then
  echo "Push recusado (remoto tem commits novos)."
  if ask "Rodar 'git pull --rebase --autostash' e tentar de novo?"; then
    git pull --rebase --autostash && doPush || { echo "Falhou. Resolva manualmente."; exit 1; }
  else exit 1; fi
fi
echo "Enviado."
