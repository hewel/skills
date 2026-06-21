---
name: execute
description: Execute implementation issues stored in supported project trackers, including GitHub, GitLab, and repo-local tracker tools such as Plane. Use when Codex is asked to work a tracker issue step by step, execute checkbox acceptance criteria as $tdd vertical slices, commit logical code units with $git-commit, push, update the tracker, and close or move the issue only after every acceptance criterion is done. Do not use for local markdown issue files unless repo docs explicitly say local markdown is the active tracker.
---

# Execute

## Overview

Work one tracker issue from acceptance criteria to completion. Use the active project tracker as the source of truth. Treat each acceptance criterion as the execution and tracker-progress slice, execute that slice with `$tdd`, and create pushed commits around logical code units rather than checkbox boundaries.

Supported trackers are:

- GitHub issues via `gh`.
- GitLab issues via `glab` or the GitLab API.
- Repo-local tracker integrations documented by the project, such as a Plane CLI or a repo-local tracker skill.

## Guardrails

- Proceed only when the issue can be fetched from the active tracker. If the user references old local markdown, read it only as archive context unless repo docs explicitly define local markdown as the active tracker.
- Prefer the tracker integration already established by the repo: `gh` for GitHub, `glab` or the GitLab API for GitLab, and repo-local tools/skills for other trackers.
- Discover non-GitHub/GitLab tracker conventions from `AGENTS.md`, `docs/agents/issue-tracker.md`, repo-local `.agents/skills/*/SKILL.md`, or issue comments before writing tracker data.
- For Plane, use the repo-local Plane skill or CLI when present, for example `$plane-tool`, `bun run plane`, or `bun tools/plane.ts`. Do not print, paste, commit, or expose Plane credentials.
- If the issue body has no explicit checkbox acceptance criteria, stop and ask for criteria instead of inventing work.
- If the issue has a parent section, do not close or rewrite the parent issue.
- Do not mark a criterion complete until the implementation and its relevant verification have actually passed.
- Use `$tdd` for implementation work inside each selected criterion: one behavior test, make it pass, then repeat. Do not write all tests first and then all implementation.
- Use logical commit units: a commit should have one cohesive, reviewable intent, pass relevant verification, and keep unrelated changes out. Do not split or bundle commits merely to mirror the acceptance-criteria checklist.
- Treat the issue body and comments as the approved TDD plan when they clearly define the desired public behavior. Ask the user only when the criterion is ambiguous, blocked, or requires an interface decision not implied by the issue.
- Keep unrelated working-tree changes out of each commit.

## Workflow

### 1. Fetch the issue

First identify the tracker adapter:

- Use the issue URL/key when it names the tracker.
- Otherwise inspect the repository remote and tracker docs, especially `docs/agents/issue-tracker.md`.
- If a repo-local tracker skill exists, read it and follow its commands for tracker reads and writes.

Read the full issue body, state, labels, comments when available, and current checkbox state from the tracker.

For GitHub, start with:

```bash
gh issue view <issue> --json number,title,state,body,labels,comments,url
```

For GitLab, use `glab issue view <issue>` or the GitLab API available in the repo environment.

For Plane through a repo-local CLI, follow the project docs. Common commands look like:

```bash
bun run plane issues get <issue-key-or-uuid> --json
bun tools/plane.ts issues get <issue-key-or-uuid> --json
```

If the Plane CLI requires an issue UUID for updates, keep both the human-readable issue key and UUID from the fetched record.

Identify:

- Issue URL/number/key, tracker, and any separate internal ID needed for updates.
- The next unchecked acceptance criterion under `## Acceptance criteria`.
- Blocking issues listed under `## Blocked by`.
- Any project-specific instructions in repo docs, `AGENTS.md`, or issue comments.

### 2. Select one criterion or coherent group

Work the earliest unchecked acceptance criterion that is not blocked. If several criteria are tightly coupled and cannot be separated safely, state that briefly, then complete the smallest coherent group.

Before editing, translate the selected criterion or coherent group into a short TDD slice plan:

- Public interface or user workflow to exercise.
- First observable behavior to prove with a failing test.
- Remaining behaviors to add one at a time after the tracer bullet passes.
- Verification command or manual/browser check that will prove the completed work.

Keep this plan behavior-focused. Do not plan around private functions, mocked internals, or speculative future behavior.

Before editing, check:

```bash
git status --porcelain
```

If unrelated changes already exist, leave them alone. When committing later, stage only files for the selected logical unit.

### 3. Execute the selected work with `$tdd`

Make the smallest end-to-end change that satisfies the selected criterion or coherent group by following the `$tdd` loop:

1. RED: write one behavior test through the public interface or user-visible workflow, then run it and confirm it fails for the expected reason.
2. GREEN: implement the minimum code needed for that behavior, then run the targeted test and confirm it passes.
3. Repeat RED/GREEN for the next behavior in the selected work.
4. REFACTOR: only after the relevant tests are green, clean up duplication or design pressure revealed by the slice, running tests after each refactor step.

Use the repository's normal tests or targeted checks that prove the selected work, and include browser/manual verification when any affected criterion requires visible behavior.

If no meaningful behavior test can be written for the selected work, state why and use the strongest available verification before committing. If verification cannot be run, do not mark affected criteria complete. Comment on the issue with the blocker and leave the checkboxes unchecked.

### 4. Commit and push logical units

After a logical code unit is implemented and verified, use `$git-commit` behavior:

- Inspect staged/unstaged diffs.
- Stage only files for this logical unit.
- Create a conventional commit that references the issue.
- Include a closing footer only if this commit completes the whole issue; otherwise use the tracker's non-closing reference syntax.
- Push the current branch.

A logical unit may cover one criterion, several tightly coupled criteria, or part of a large criterion. If one commit completes multiple criteria, update all completed checkboxes after the push. If one criterion needs several logical commits, leave that checkbox unchecked until the full criterion is verified.

Typical GitHub/GitLab non-final footer:

```text
Refs #123
```

Typical GitHub/GitLab final footer:

```text
Closes #123
```

For GitLab or other trackers, use the project’s accepted issue reference syntax. For Plane, prefer the visible issue key in the commit body, such as `Refs THG-12`, unless repo docs specify another format.

### 5. Update the issue

After the push succeeds:

- Mark completed acceptance criteria checked in the issue body/description when the tracker supports body edits.
- Add a comment with the commit hash, pushed branch, and verification command/result.
- Leave unchecked criteria unchanged.

If body editing is unavailable, add a comment that names the completed criteria and explains why the checkboxes could not be edited.

For Plane through a repo-local CLI, update descriptions and comments through temporary files so shell quoting does not corrupt markdown:

```bash
bun run plane issues update <issue-uuid> --description-file <tmp-updated-body.md>
bun run plane issues comment <issue-uuid> --body-file <tmp-comment.md>
```

Use the command names documented by the repo-local Plane skill or docs when they differ.

### 6. Repeat

Fetch the issue again before starting the next criterion or coherent group so concurrent tracker edits are not overwritten. Continue until no unchecked acceptance criteria remain.

### 7. Close the issue

Close, resolve, or move the issue to the project’s done state only after all acceptance criteria are checked or explicitly confirmed complete, all logical commits are pushed, and no blocking issue remains open.

For GitHub:

```bash
gh issue close <issue> --comment "<summary>"
```

For GitLab, use `glab issue close <issue>` or the GitLab API available in the repo environment.

For Plane, inspect the available states first, then update the issue to the done/closed state through the repo-local CLI or API:

```bash
bun run plane states list
bun run plane issues update <issue-uuid> --state <done-state-uuid>
```

The closing summary or final tracker comment should list the final commit range or key commit hashes and the verification performed.
