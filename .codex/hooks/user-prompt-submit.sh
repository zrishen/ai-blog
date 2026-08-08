#!/bin/bash
# planning-with-files: User prompt submit hook for Codex

# issue #195: per-invocation opt-out for one-shot/CI sessions (e.g. codex exec)
# that share a cwd with a plan but never opted into it.
[ "${PLANNING_DISABLED:-}" = "1" ] && exit 0

# --- PWF_PLAN_ROOT: absolute plan-root binding (issue #212). ---
# A thread whose cwd is a shared PARENT of the real project (e.g. /workspace
# holding /workspace/project with its own .planning/.active_plan) used to
# resolve the parent's plan on every hook fire and never see the nested one.
# PWF_PLAN_ROOT names the project root whose .planning must be used; every
# planning-state path read below goes through ${PLAN_PREFIX}, and the shared
# resolver honors the same variable. With the var unset the prefix is EMPTY so
# every path string stays byte-identical to the legacy shape. An explicit but
# broken pin fails CLOSED: pointing PWF_PLAN_ROOT at a non-directory emits one
# notice and injects nothing, never silently falls back to the ambiguous cwd
# plan the caller was escaping. Wording matches scripts/inject-plan.sh.
PLAN_PREFIX=""
if [ -n "${PWF_PLAN_ROOT:-}" ]; then
    if [ -d "${PWF_PLAN_ROOT}" ]; then
        PLAN_PREFIX="${PWF_PLAN_ROOT}/"
    else
        echo "[planning-with-files] PWF_PLAN_ROOT is not a directory: ${PWF_PLAN_ROOT} — nothing injected."
        exit 0
    fi
fi

# Session isolation: if .planning/sessions/ exists, only attached sessions see
# plan context. Absence of the sessions dir means legacy single-session mode —
# all sessions in the cwd receive context to preserve backward compatibility.
# issue #212: the refusal is no longer silent. This hook fires once per turn,
# so one diagnosable line is not spam; the per-tool-call hooks (the Python
# adapter's guard) stay silent. Wording matches scripts/inject-plan.sh so all
# three routes say the same thing.
SESSION_ATTACHED=0
if [ -d "${PLAN_PREFIX}.planning/sessions" ]; then
    SESSION_ID="${PWF_SESSION_ID:-}"
    if [ -z "$SESSION_ID" ] || [ ! -f "${PLAN_PREFIX}.planning/sessions/${SESSION_ID}.attached" ]; then
        echo "[planning-with-files] Session isolation is armed (${PLAN_PREFIX}.planning/sessions/ exists) and this session is not attached, so no plan was injected. Attach it with PWF_SESSION_ID=<id> plus ${PLAN_PREFIX}.planning/sessions/<id>.attached, or delete that sessions directory to turn isolation off."
        exit 0
    fi
    SESSION_ATTACHED=1
fi

HOOK_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
PLAN_DIR="$(sh "${HOOK_DIR}/resolve-plan-dir.sh" 2>/dev/null)"
if [ -n "$PLAN_DIR" ]; then
    PLAN_FILE="${PLAN_DIR}/task_plan.md"
    PROGRESS_FILE="${PLAN_DIR}/progress.md"
else
    # ${PLAN_PREFIX} is empty in the legacy case, so these strings stay
    # byte-identical to the historical relative shape ("task_plan.md").
    PLAN_FILE="${PLAN_PREFIX}task_plan.md"
    PROGRESS_FILE="${PLAN_PREFIX}progress.md"
fi

# Plan-id safe-identifier check. Pure-sh case patterns; shared shape with
# resolve-plan-dir.sh, needed below to decide whether PLAN_ID named the plan.
slug_is_valid() {
    case "$1" in
        '') return 1 ;;
        *[!A-Za-z0-9._-]*) return 1 ;;
        [A-Za-z0-9_]*) return 0 ;;
    esac
    return 1
}

# EXPLICIT tracks WHO chose the plan (issue #212). A valid PLAN_ID, a valid
# PWF_PLAN_ROOT pin, or an attached session all name the plan deliberately.
# The .active_plan pointer, the newest-by-mtime fallback, and the legacy root
# task_plan.md are cwd GUESSES — only guesses are subject to the nested-root
# conflict check below. Mirrors scripts/inject-plan.sh.
EXPLICIT=0
[ -n "$PLAN_PREFIX" ] && EXPLICIT=1
[ "$SESSION_ATTACHED" = "1" ] && EXPLICIT=1
if [ -n "${PLAN_ID:-}" ] && slug_is_valid "$PLAN_ID" && [ -d "${PLAN_PREFIX}.planning/${PLAN_ID}" ]; then
    EXPLICIT=1
fi

if [ -f "$PLAN_FILE" ]; then
    # --- Nested-root conflict detection (issue #212): fail CLOSED on ambiguity.
    # Only a cwd guess gets here with EXPLICIT=0. If a direct child of the
    # effective root carries its own competing .planning (an .active_plan
    # pointer, or at least one <slug>/task_plan.md), this cwd is a shared
    # parent and "the plan under $PWD" is the wrong answer for at least one
    # thread — so inject NOTHING and say why. Depth 1 only: one shell glob per
    # hook fire is the whole perf budget; the effective root's own .planning is
    # never a hit because `*` does not match dotted names. Wording matches
    # scripts/inject-plan.sh.
    if [ "$EXPLICIT" = "0" ]; then
        NESTED_LIST=""
        NESTED_N=0
        for nd in "${PLAN_PREFIX}"*/.planning; do
            [ -d "$nd" ] || continue
            COMPETING=0
            [ -f "${nd}/.active_plan" ] && COMPETING=1
            if [ "$COMPETING" = "0" ]; then
                for np in "${nd}"/*/task_plan.md; do
                    [ -f "$np" ] && { COMPETING=1; break; }
                done
            fi
            [ "$COMPETING" = "1" ] || continue
            NR="${nd%/.planning}"
            NR="${NR#"${PLAN_PREFIX}"}"
            NESTED_N=$((NESTED_N + 1))
            if [ "$NESTED_N" -le 3 ]; then
                if [ -z "$NESTED_LIST" ]; then NESTED_LIST="$NR"; else NESTED_LIST="${NESTED_LIST}, ${NR}"; fi
            fi
        done
        if [ "$NESTED_N" -gt 0 ]; then
            echo "[planning-with-files] Ambiguous plan: this cwd has an active plan and a nested project below it has its own (${NESTED_LIST}). Nothing injected. Pin the thread with PWF_PLAN_ROOT=<absolute path> or PLAN_ID=<slug>."
            exit 0
        fi
    fi

    echo "[planning-with-files] ACTIVE PLAN — current state:"
    head -50 "$PLAN_FILE"
    echo ""
    echo "=== recent progress ==="
    # Timestamp normalization matches scripts/inject-plan.sh (KV-cache stability, v2.40).
    tail -20 "$PROGRESS_FILE" 2>/dev/null | sed -E 's/T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z/T00:00:00Z/g; s/T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}:[0-9]{2})/T00:00:00\2/g'
    echo ""
    echo "[planning-with-files] Read findings.md for research context. Continue from the current phase."
fi
exit 0
