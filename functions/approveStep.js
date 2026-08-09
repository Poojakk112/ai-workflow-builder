// functions/approveStep.js
//
// This is a Hasura ACTION handler for the "approveStep" mutation.
// It checks the approver's role (owner/editor) in the app code -
// this is Layer 2 step-level gating, done here because it's a
// mid-execution decision, not something a simple database
// permission can express.
//
// After approving, it resumes the workflow run from the NEXT step
// after the approval_gate, reusing the same step-execution logic
// as triggerWorkflowRun.

const HASURA_GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL || process.env.HASURA_GRAPHQL_URL;
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || process.env.HASURA_GRAPHQL_ADMIN_SECRET;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function gql(query, variables) {
  const res = await fetch(HASURA_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error('GraphQL error:', JSON.stringify(json.errors));
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

async function createStepRun(workflowRunId, stepId) {
  const data = await gql(
    `mutation($run_id: uuid!, $step_id: uuid!) {
      insert_step_runs_one(object: {
        workflow_run_id: $run_id,
        step_id: $step_id,
        status: "running",
        started_at: "now()"
      }) { id }
    }`,
    { run_id: workflowRunId, step_id: stepId }
  );
  return data.insert_step_runs_one.id;
}

async function updateStepRun(stepRunId, fields) {
  await gql(
    `mutation($id: uuid!, $changes: step_runs_set_input!) {
      update_step_runs_by_pk(pk_columns: { id: $id }, _set: $changes) { id }
    }`,
    { id: stepRunId, changes: fields }
  );
}

async function updateWorkflowRun(runId, fields) {
  await gql(
    `mutation($id: uuid!, $changes: workflow_runs_set_input!) {
      update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: $changes) { id }
    }`,
    { id: runId, changes: fields }
  );
}

// --- same step runner logic as triggerWorkflowRun.js ---
async function runLlmCall(step, previousOutput) {
  const prompt = step.config.prompt || 'Say hello.';
  const finalPrompt = previousOutput
    ? `${prompt}\n\nPrevious step output: ${JSON.stringify(previousOutput)}`
    : prompt;
  if (!GROQ_API_KEY) {
    await new Promise((r) => setTimeout(r, 800));
    return { stubbed: true, text: `Stubbed LLM response for prompt: ${finalPrompt}` };
  }
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: finalPrompt }] }),
  });
  if (!res.ok) throw new Error(`Groq API error: ${res.status}`);
  const json = await res.json();
  return { text: json.choices?.[0]?.message?.content || '' };
}

async function runHttpRequest(step) {
  const { url, method = 'GET', headers = {}, body } = step.config;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) throw new Error(`HTTP request failed: ${res.status}`);
  return { status: res.status, data: parsed };
}

async function runDbWrite(step, previousOutput) {
  return { saved: true, data: step.config.data || previousOutput || {} };
}

async function runNotify(step) {
  return { queued: true, channel: step.config.channel || 'default' };
}

function runConditionalBranch(step, previousOutput) {
  const { field, equals } = step.config;
  let value = previousOutput;
  if (field) {
    value = field.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), previousOutput);
  }
  const matched = String(value).toLowerCase().includes(String(equals).toLowerCase());
  return { matched, branch: matched ? 'true_branch' : 'false_branch', checkedValue: value };
}

async function executeStep(step, previousOutput) {
  const retryableTypes = ['llm_call', 'http_request'];
  const maxAttempts = retryableTypes.includes(step.step_type) ? 2 : 1;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      switch (step.step_type) {
        case 'llm_call':
          return { output: await runLlmCall(step, previousOutput), attempts: attempt };
        case 'http_request':
          return { output: await runHttpRequest(step), attempts: attempt };
        case 'db_write':
          return { output: await runDbWrite(step, previousOutput), attempts: attempt };
        case 'notify':
          return { output: await runNotify(step), attempts: attempt };
        case 'conditional_branch':
          return { output: runConditionalBranch(step, previousOutput), attempts: attempt };
        default:
          throw new Error(`Unknown step_type: ${step.step_type}`);
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// ---------- main handler ----------
export default async function handler(req, res) {
  try {
    const { input, session_variables } = req.body;
    const stepRunId = input.step_run_id;
    const userId = session_variables?.['x-hasura-user-id'];

    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    // Load the paused step_run, its step, its run, its workflow, its org
    const data = await gql(
      `query($id: uuid!) {
        step_runs_by_pk(id: $id) {
          id
          status
          workflow_run_id
          step {
            id
            step_order
            workflow_id
            workflow {
              org_id
              workflow_steps(order_by: { step_order: asc }) {
                id
                step_order
                step_type
                config
              }
            }
          }
        }
      }`,
      { id: stepRunId }
    );

    const stepRun = data.step_runs_by_pk;
    if (!stepRun) {
      return res.status(404).json({ message: 'Step run not found' });
    }
    if (stepRun.status !== 'paused') {
      return res.status(400).json({ message: 'This step is not awaiting approval' });
    }

    const orgId = stepRun.step.workflow.org_id;

    // Layer 2 check: approver must be owner/editor in this org.
    // Done here in code (not a DB permission) because this is a
    // mid-execution business decision.
    const memberData = await gql(
      `query($org_id: uuid!, $user_id: uuid!) {
        org_members(where: { org_id: { _eq: $org_id }, user_id: { _eq: $user_id } }) {
          role
        }
      }`,
      { org_id: orgId, user_id: userId }
    );
    const membership = memberData.org_members[0];
    if (!membership || !['owner', 'editor'].includes(membership.role)) {
      return res.status(403).json({ message: 'Not authorized to approve this step' });
    }

    // Mark this step_run as approved + completed
    await updateStepRun(stepRunId, {
      status: 'completed',
      approved_by: userId,
      approved_at: 'now()',
      finished_at: 'now()',
    });

    const runId = stepRun.workflow_run_id;
    await updateWorkflowRun(runId, { status: 'running' });

    // Resume: run every step AFTER the approval_gate step
    const allSteps = stepRun.step.workflow.workflow_steps;
    const currentIndex = allSteps.findIndex((s) => s.id === stepRun.step.id);
    const remainingSteps = allSteps.slice(currentIndex + 1);

    let previousOutput = { approved: true };
    for (const step of remainingSteps) {
      const newStepRunId = await createStepRun(runId, step.id);

      if (step.step_type === 'approval_gate') {
        // another approval gate further down the workflow
        await updateStepRun(newStepRunId, { status: 'paused' });
        await updateWorkflowRun(runId, { status: 'paused' });
        return res.status(200).json({ run_id: runId, status: 'paused' });
      }

      try {
        const { output, attempts } = await executeStep(step, previousOutput);
        await updateStepRun(newStepRunId, {
          status: 'completed',
          output,
          attempt_count: attempts,
          finished_at: 'now()',
        });
        previousOutput = output;
      } catch (err) {
        await updateStepRun(newStepRunId, {
          status: 'failed',
          error: err.message,
          attempt_count: 2,
          finished_at: 'now()',
        });
        await updateWorkflowRun(runId, { status: 'failed', finished_at: 'now()' });
        return res.status(200).json({ run_id: runId, status: 'failed', message: err.message });
      }
    }

    await updateWorkflowRun(runId, { status: 'completed', finished_at: 'now()' });
    return res.status(200).json({ run_id: runId, status: 'completed' });
  } catch (err) {
    console.error('approveStep error:', err);
    return res.status(500).json({ message: err.message });
  }
}
