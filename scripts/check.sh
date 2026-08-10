#!/usr/bin/env bash
# Run the full check suite (web + API): format check, lint, typecheck, test — matches
# CI. Optional locally; running it before pushing catches failures early, but CI runs
# the same checks regardless.
#
# The formatters run in check mode, not write mode, so this script never touches the
# working tree — that is what makes it match CI. Use scripts/format.sh to reformat.
#
# The checks are independent of each other, so they all run concurrently and the script
# is as slow as its slowest single check rather than their sum. Two consequences:
#
#   - Each check's output is captured and only the failures are printed, at the end.
#     A progress line reports which checks are still running in the meantime, so a long
#     one can't be mistaken for a hang.
#   - Every check runs to completion even after one fails, so a run reports every
#     problem at once instead of stopping at the first.
#
# No `set -e`: this script inspects each check's exit status itself, and under `-e` the
# arithmetic below would abort the script whenever it evaluated to 0.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# name|directory|command. Grouped by toolchain, matching the job families in CI.
checks=(
  "prettier|.|pnpm run format:check"
  "eslint|.|pnpm run lint"
  "tsc|.|pnpm run typecheck"
  "vitest|.|pnpm run test"
  "ruff-format|apps/api|uv run ruff format --check ."
  "ruff-check|apps/api|uv run ruff check ."
  "pyright|apps/api|uv run pyright"
  "pytest|apps/api|uv run pytest"
)

now_ms() { date +%s%3N; }
fmt_ms() { printf '%d.%ds' "$(($1 / 1000))" "$((($1 % 1000) / 100))"; }

names=()
for entry in "${checks[@]}"; do
  IFS='|' read -r name dir cmd <<<"$entry"
  names+=("$name")
  # Word-split into an argv array rather than eval'ing the string.
  read -ra argv <<<"$cmd"
  (
    start=$(now_ms)
    if (cd "$repo_root/$dir" && "${argv[@]}") >"$work/$name.log" 2>&1; then
      status=ok
    else
      status=fail
    fi
    # Write then rename, so the reader below can never see a half-written line.
    printf '%s %s\n' "$status" "$(($(now_ms) - start))" >"$work/$name.tmp"
    mv "$work/$name.tmp" "$work/$name.done"
  ) &
done

total=${#names[@]}
printf 'running %d checks\n' "$total"

is_tty=0
[ -t 1 ] && is_tty=1
width=${COLUMNS:-$(tput cols 2>/dev/null || echo 80)}
spinner=('-' '\' '|' '/')
frame=0
run_start=$(now_ms)
declare -A result=()

while ((${#result[@]} < total)); do
  for name in "${names[@]}"; do
    [[ -n ${result[$name]:-} ]] && continue
    [[ -f "$work/$name.done" ]] || continue
    read -r status elapsed <"$work/$name.done"
    result[$name]=$status
    ((is_tty)) && printf '\r\033[K'
    if [ "$status" = ok ]; then
      printf '  ok   %-12s %s\n' "$name" "$(fmt_ms "$elapsed")"
    else
      printf '  FAIL %-12s %s\n' "$name" "$(fmt_ms "$elapsed")"
    fi
  done

  ((${#result[@]} == total)) && break

  if ((is_tty)); then
    pending=()
    for name in "${names[@]}"; do
      [[ -z ${result[$name]:-} ]] && pending+=("$name")
    done
    line=$(printf ' %s  %s  waiting on %d: %s' "${spinner[frame % 4]}" \
      "$(fmt_ms "$(($(now_ms) - run_start))")" "${#pending[@]}" \
      "$(
        IFS=,
        echo "${pending[*]}"
      )")
    printf '\r\033[K%s' "${line:0:width - 1}"
    frame=$((frame + 1))
  fi
  sleep 0.2
done
((is_tty)) && printf '\r\033[K'

failed=()
for name in "${names[@]}"; do
  [ "${result[$name]}" = fail ] && failed+=("$name")
done

if ((${#failed[@]})); then
  for name in "${failed[@]}"; do
    printf '\n--- %s ---\n' "$name"
    cat "$work/$name.log"
  done
  printf '\n%d of %d checks failed: %s\n' "${#failed[@]}" "$total" "${failed[*]}" >&2
  exit 1
fi

printf 'all %d checks passed in %s\n' "$total" "$(fmt_ms "$(($(now_ms) - run_start))")"
