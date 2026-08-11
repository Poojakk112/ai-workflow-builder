# AI Agent Workflow Builder

A mini n8n-style workflow builder for chaining AI agent steps, built with
nhost (Postgres + Hasura + Auth + Functions), Hasura GraphQL, and Next.js.

**Live app:** https://ai-workflow-builder-i3y97fxw6-poojakk112s-projects.vercel.app

## What's implemented (tested and working)

### Data Model
All required tables exist with correct relationships:
`organizations`, `org_members`, `workflows`, `workflow_steps`,
`workflow_triggers`, `workflow_runs`, `step_runs`.

### Permissions — two layers
- **Layer 1 (org + role scoping):** every table's permissions are scoped
  through `org_members`, so a role only grants access within the caller's
  own organization. **Tested live:** created a second organization with
  its own user — that user cannot see the first org's workflows on the
  dashboard, and cannot access them even by pasting the workflow's URL
  directly (returns "Workflow not found").
- **Layer 2 (step-level gating):** `editor` role is blocked at the
  database level from inserting `db_write` steps or `webhook` triggers —
  only `owner` can. Approval-gate resolution is checked in the
  `approveStep` Action handler itself, since it's a mid-execution
  decision, not a static row permission.

### The Integration — Hasura Actions
- `triggerWorkflowRun(workflow_id, trigger_type)` — nhost Function
  (`functions/triggerWorkflowRun.js`), registered as a Hasura Action.
  Verifies caller is owner/editor in the org, checks quota, creates a
  workflow_run, executes steps in order (llm_call, http_request,
  db_write, notify, conditional_branch) with one retry on
  llm_call/http_request, pauses on approval_gate, and increments quota
  on completion.
- `approveStep(step_run_id)` — nhost Function
  (`functions/approveStep.js`), registered as a Hasura Action. Re-checks
  the approver's role in code before resuming the run from the next
  step after the approval_gate, and correctly increments quota when a
  resumed run finishes.
- **Tested end-to-end on the live deployed app:** ran a workflow with
  llm_call → approval_gate, watched it pause live via subscription,
  clicked Approve, watched it resume and complete, and confirmed quota
  incremented correctly.

### Two ways to start a workflow
- **Manual:** the Run button in the UI.
- **Webhook:** `triggerWorkflowRun` is a real callable HTTP endpoint via
  Hasura's Action system. Tested by calling it directly with `curl` from
  outside the app (simulating an external system), completely bypassing
  the UI — it started and completed the run correctly.

### Frontend
- Auth via nhost (sign up / sign in / sign out)
- Org context — dashboard shows the current organization, role, and
  quota usage
- Workflow builder screen — add steps of any type with JSON config,
  attach a trigger
- Run button (visible per role) with **live, subscription-based
  step-by-step status** — no page refresh needed, including the
  "paused, awaiting approval" state and an inline Approve button

## What's not finished

- Computed field / Postgres view for organization usage aggregation
  (e.g. average run duration) — not added.
- Scheduled (cron) and database-event trigger types — `workflow_triggers`
  rows can be created for these, but only `manual` and `webhook` are
  wired to actually fire a run automatically. `webhook` is proven
  working (see above).
- `notify` step type does not yet send a real Slack/email alert via a
  Hasura Event Trigger — currently just records the intent.

## Setup

1. `npm install`
2. Configure `nhost/nhost.toml` with your nhost project subdomain/region.
3. Set environment variables in your nhost project:
   - `GROQ_API_KEY` (optional — falls back to a stubbed LLM response with
     an artificial delay if not set)
4. `npm run dev` to run the Next.js app locally, or use the live
   deployed URL above.

See `WRITEUP.md` for schema reasoning, how the two permission layers
are enforced differently, and how the approval-gate pause/resume flow
is implemented.
