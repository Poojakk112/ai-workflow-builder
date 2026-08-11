# AI Agent Workflow Builder

Built with nhost (Postgres + Hasura + Auth + Functions), Hasura GraphQL, and Next.js.

## What's implemented

### Data Model (done)
All required tables exist with correct relationships:
`organizations`, `org_members`, `workflows`, `workflow_steps`,
`workflow_triggers`, `workflow_runs`, `step_runs`.

### Permissions - two layers (done)
- **Layer 1 (org + role scoping):** every table's permissions are scoped
  through `org_members`, so a role only grants access within the caller's
  own organization - verified via Hasura's row-level permission filters
  on every table.
- **Layer 2 (step-level gating):** `editor` role is blocked at the
  database level from inserting `db_write` steps or `webhook` triggers -
  only `owner` can. Approval-gate resolution is checked in the Action
  handler itself (see below), since it's a mid-execution decision.

### The Integration - Hasura Actions (done, tested working)
- `triggerWorkflowRun(workflow_id)` - implemented as an nhost Function
  (`functions/triggerWorkflowRun.js`), registered as a Hasura Action.
  Verifies caller is owner/editor in the org, checks quota, creates a
  workflow_run, executes steps in order (llm_call, http_request, db_write,
  notify, conditional_branch) with one retry on llm_call/http_request,
  pauses on approval_gate, and increments quota on completion.
- `approveStep(step_run_id)` - implemented as an nhost Function
  (`functions/approveStep.js`), registered as a Hasura Action. Re-checks
  the approver's role in code (owner/editor) before resuming the run from
  the next step after the approval_gate.
- **Tested manually via Hasura's GraphiQL console** with a real org, a
  real nhost auth user (role=owner), and a real workflow: calling
  `triggerWorkflowRun` returned `status: "completed"` and correctly
  incremented the organization's `quota_used` from 0 to 1.

## What's not finished

- **Frontend UI** - only the default Next.js scaffold exists. No
  login/signup screen, workflow builder, run button, or live
  subscription view has been built yet. The backend (schema,
  permissions, both Actions) is fully functional and was tested directly
  against Hasura's API.
- Computed field / view for organization usage aggregation - not added.
- A second trigger type (webhook/scheduled/event) is not yet wired to
  actually fire automatically - `workflow_triggers` rows can be created,
  but nothing currently listens for a real webhook or cron event.

## Setup

1. `npm install`
2. Configure `nhost/nhost.toml` with your nhost project subdomain/region.
3. Set environment variables in your nhost project:
   - `GROQ_API_KEY` (optional - falls back to a stubbed LLM response with
     an artificial delay if not set)
4. `npm run dev` to run the Next.js app locally.

## Known limitation

Given time constraints, this submission proves the backend logic works
correctly end-to-end (schema, both permission layers, both Actions) but
does not yet include a working frontend. Backend testing was done
directly via Hasura's GraphiQL console, authenticated as a real nhost
user with the `owner` role.
