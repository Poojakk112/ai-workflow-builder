# AI Agent Workflow Builder — Technical Write-up

## Schema Reasoning

The schema follows the natural hierarchy the assignment describes: an
organization owns workflows, workflows own steps and triggers, and each
execution produces a run with per-step records.

`organizations` holds the quota (`quota_limit` / `quota_used`) at the
top level, since usage limits are a property of the organization as a
whole, not any individual workflow. `org_members` is a join table
between users and organizations, carrying the role (`owner`/`editor`/
`viewer`) — this indirection is what makes multi-org membership
possible (a user can belong to several orgs with different roles in
each) and is the anchor that every permission rule is built on.

`workflows` belongs to exactly one organization. `workflow_steps` and
`workflow_triggers` both belong to a workflow, kept as separate tables
since a step is "what happens" and a trigger is "what starts it" —
different concerns with different shapes. `step_order` is a plain
integer rather than a linked-list structure, since workflows in this
assignment are simple ordered sequences, not branching graphs (the
`conditional_branch` step type changes what happens with the *output*
of a step, not the *structure* of the workflow).

`workflow_runs` and `step_runs` are separate from their definition
tables (`workflows`/`workflow_steps`) so that a workflow's definition
can change over time without affecting the historical record of past
runs — each `step_run` snapshots its own `input`/`output`/`error`,
independent of whatever the step's config looks like now.

## How the Two Permission Layers Are Enforced Differently

**Layer 1 (org + role scoping)** is enforced entirely as Hasura row-level
permissions — no custom code. Every table's `select`/`insert`/`update`/
`delete` permission includes a filter that traces back to `org_members`,
checking that a row belonging to `_eq: X-Hasura-User-Id` exists for that
row's organization. This works because Hasura evaluates these filters
as SQL `WHERE` clauses joined into the underlying query, so a user
genuinely cannot retrieve or affect a row outside their org — it's not
a check that runs after the fact, the row is simply excluded from the
result set entirely. This is why cross-org isolation holds even against
a user directly guessing a workflow ID by URL: the row is filtered out
at the database level regardless of how the request was constructed.

**Layer 2 (step-level gating)** is split across two different
mechanisms depending on when the decision needs to be made:

- For step *types* that reach outside the sandbox (`db_write`, a
  `webhook` trigger), gating is still a database permission — the
  `editor` role's `insert` permission on `workflow_steps` and
  `workflow_triggers` explicitly excludes these values, while `owner`'s
  does not. This is a static rule (the same for every request) so it
  fits naturally as a permission.
- For the `approval_gate` step, the decision ("can this specific person
  approve this specific paused step, right now") is not a property of
  a row someone is reading or writing — it's a business decision made
  mid-execution, by the `approveStep` Action handler. The handler
  re-queries `org_members` for the approver's role at the moment of
  approval and rejects the request in code if they're not owner/editor
  in that workflow's org. This has to live in code rather than a
  permission because Hasura's permission system only expresses "can
  this role read/write this row," not "is this specific transition
  allowed right now."

## Approval-Gate Pause/Resume Implementation

`triggerWorkflowRun` executes `workflow_steps` in `step_order` sequence.
When it reaches a step with `step_type = 'approval_gate'`, it creates a
`step_runs` row with `status: 'paused'`, sets the parent `workflow_runs`
row to `status: 'paused'`, and returns immediately — no further steps
execute, and the function call ends there.

`approveStep(step_run_id)` is a separate Action. It loads the paused
`step_run`, re-checks the approver's org role (Layer 2, above), then
marks that step_run `completed` with `approved_by`/`approved_at` set,
and sets the workflow_run back to `running`. It then looks up all steps
in the workflow, finds the index of the approval_gate step that was
just approved, and continues executing every step *after* it in order —
reusing the same step-execution logic (`executeStep`) as
`triggerWorkflowRun`, including retries on `llm_call`/`http_request`.
If a second `approval_gate` is hit further down the workflow, the same
pause behavior repeats. When the remaining steps finish, quota usage is
incremented and the run is marked `completed` — this only happens once,
at the true end of the workflow, whether that's the first call or a
resumed one.

Because `step_runs` are being updated live throughout both functions,
a GraphQL subscription on `step_runs` (filtered by `workflow_run_id`)
reflects every step's status in real time on the frontend, including
the `paused` state, without the client needing to poll or refresh.
