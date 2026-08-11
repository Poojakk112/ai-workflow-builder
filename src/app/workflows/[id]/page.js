'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { gql, useQuery, useMutation, useSubscription } from '@apollo/client';
import { useUserId } from '@nhost/react';

const WORKFLOW_DETAIL = gql`
  query WorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      org_id
      workflow_steps(order_by: { step_order: asc }) {
        id
        step_order
        step_type
        config
      }
      workflow_triggers {
        id
        trigger_type
        config
      }
    }
  }
`;

const MY_ROLE = gql`
  query MyRole($org_id: uuid!, $user_id: uuid!) {
    org_members(where: { org_id: { _eq: $org_id }, user_id: { _eq: $user_id } }) {
      role
    }
  }
`;

const ADD_STEP = gql`
  mutation AddStep($workflow_id: uuid!, $step_order: Int!, $step_type: String!, $config: jsonb!) {
    insert_workflow_steps_one(
      object: { workflow_id: $workflow_id, step_order: $step_order, step_type: $step_type, config: $config }
    ) {
      id
    }
  }
`;

const ADD_TRIGGER = gql`
  mutation AddTrigger($workflow_id: uuid!, $trigger_type: String!) {
    insert_workflow_triggers_one(object: { workflow_id: $workflow_id, trigger_type: $trigger_type }) {
      id
    }
  }
`;

const TRIGGER_RUN = gql`
  mutation TriggerRun($workflow_id: uuid!) {
    triggerWorkflowRun(workflow_id: $workflow_id) {
      run_id
      status
      message
    }
  }
`;

const APPROVE_STEP = gql`
  mutation ApproveStep($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      run_id
      status
      message
    }
  }
`;

const STEP_RUNS_SUB = gql`
  subscription StepRuns($run_id: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $run_id } }, order_by: { started_at: asc }) {
      id
      status
      output
      error
      workflow_step {
        step_type
        step_order
      }
    }
  }
`;

const STEP_TYPES = ['llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate'];
const TRIGGER_TYPES = ['manual', 'webhook', 'scheduled', 'database_event'];

export default function WorkflowDetail() {
  const { id } = useParams();
  const router = useRouter();
  const userId = useUserId();
  const [newStepType, setNewStepType] = useState('llm_call');
  const [newStepConfig, setNewStepConfig] = useState('{"prompt": "Say hello"}');
  const [newTriggerType, setNewTriggerType] = useState('manual');
  const [runId, setRunId] = useState(null);
  const [runMessage, setRunMessage] = useState('');

  const { data, loading, refetch } = useQuery(WORKFLOW_DETAIL, { variables: { id } });
  const workflow = data?.workflows_by_pk;

  const { data: roleData } = useQuery(MY_ROLE, {
    variables: { org_id: workflow?.org_id, user_id: userId },
    skip: !workflow?.org_id || !userId,
  });
  const myRole = roleData?.org_members[0]?.role;

  const [addStep, { loading: addingStep }] = useMutation(ADD_STEP);
  const [addTrigger, { loading: addingTrigger }] = useMutation(ADD_TRIGGER);
  const [triggerRun, { loading: running }] = useMutation(TRIGGER_RUN);
  const [approveStep] = useMutation(APPROVE_STEP);

  const { data: subData, error: subError, loading: subLoading } = useSubscription(STEP_RUNS_SUB, {
    variables: { run_id: runId },
    skip: !runId,
  });

  if (loading) return <main style={styles.page}>Loading...</main>;
  if (!workflow) return <main style={styles.page}>Workflow not found.</main>;

  async function handleAddStep(e) {
    e.preventDefault();
    let parsedConfig;
    try {
      parsedConfig = JSON.parse(newStepConfig);
    } catch {
      alert('Config must be valid JSON');
      return;
    }
    const nextOrder = (workflow.workflow_steps.at(-1)?.step_order || 0) + 1;
    await addStep({
      variables: { workflow_id: id, step_order: nextOrder, step_type: newStepType, config: parsedConfig },
    });
    refetch();
  }

  async function handleAddTrigger(e) {
    e.preventDefault();
    await addTrigger({ variables: { workflow_id: id, trigger_type: newTriggerType } });
    refetch();
  }

  async function handleRun() {
    setRunMessage('');
    const { data } = await triggerRun({ variables: { workflow_id: id } });
    const result = data?.triggerWorkflowRun;
    if (result?.run_id) setRunId(result.run_id);
    if (result?.message) setRunMessage(result.message);
  }

  async function handleApprove(stepRunId) {
    const { data } = await approveStep({ variables: { step_run_id: stepRunId } });
    if (data?.approveStep?.message) setRunMessage(data.approveStep.message);
  }

  const canEdit = ['owner', 'editor'].includes(myRole);
  const canRun = ['owner', 'editor'].includes(myRole);
  const stepRuns = subData?.step_runs || [];

  return (
    <main style={styles.page}>
      <button onClick={() => router.push('/dashboard')} style={styles.back}>
        ← Back to Dashboard
      </button>
      <h1 style={styles.h1}>{workflow.name}</h1>
      <p style={{ color: '#888', fontSize: 13 }}>Your role: {myRole || 'unknown'}</p>

      <section style={styles.card}>
        <h2 style={styles.h2}>Steps</h2>
        {workflow.workflow_steps.length === 0 && <p>No steps yet.</p>}
        {workflow.workflow_steps.map((s) => (
          <div key={s.id} style={styles.stepRow}>
            <span style={styles.stepOrder}>{s.step_order}</span>
            <span style={styles.stepType}>{s.step_type}</span>
            <code style={styles.stepConfig}>{JSON.stringify(s.config)}</code>
          </div>
        ))}

        {canEdit && (
          <form onSubmit={handleAddStep} style={styles.form}>
            <select value={newStepType} onChange={(e) => setNewStepType(e.target.value)} style={styles.select}>
              {STEP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={newStepConfig}
              onChange={(e) => setNewStepConfig(e.target.value)}
              placeholder='config as JSON, e.g. {"prompt":"..."}'
              style={{ ...styles.select, flex: 1 }}
            />
            <button type="submit" disabled={addingStep} style={styles.button}>
              + Add Step
            </button>
          </form>
        )}
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>Triggers</h2>
        {workflow.workflow_triggers.length === 0 && <p>No triggers yet (manual run always works).</p>}
        {workflow.workflow_triggers.map((t) => (
          <div key={t.id} style={styles.stepRow}>
            <span style={styles.stepType}>{t.trigger_type}</span>
          </div>
        ))}
        {canEdit && (
          <form onSubmit={handleAddTrigger} style={styles.form}>
            <select value={newTriggerType} onChange={(e) => setNewTriggerType(e.target.value)} style={styles.select}>
              {TRIGGER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button type="submit" disabled={addingTrigger} style={styles.button}>
              + Add Trigger
            </button>
          </form>
        )}
      </section>

      {canRun && (
        <section style={styles.card}>
          <button onClick={handleRun} disabled={running} style={styles.runButton}>
            {running ? 'Starting...' : '▶ Run Workflow'}
          </button>
          {runMessage && <p style={{ marginTop: 8, color: '#666' }}>{runMessage}</p>}
        </section>
      )}

      {runId && (
        <section style={styles.card}>
          <h2 style={styles.h2}>Live Run Status</h2>
          {stepRuns.length === 0 && <p>Waiting for steps to start...</p>}
          {stepRuns.map((sr) => (
            <div key={sr.id} style={styles.stepRow}>
              <span style={styles.stepType}>
                {sr.workflow_step.step_order}. {sr.workflow_step.step_type}
              </span>
              <span style={statusBadge(sr.status)}>{sr.status}</span>
              {sr.status === 'paused' && (
                <button onClick={() => handleApprove(sr.id)} style={styles.approveButton}>
                  Approve
                </button>
              )}
              {sr.error && <span style={{ color: 'red', fontSize: 12 }}>{sr.error}</span>}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

function statusBadge(status) {
  const colors = {
    completed: '#16a34a',
    running: '#2563eb',
    paused: '#d97706',
    failed: '#dc2626',
    pending: '#888',
  };
  return {
    fontSize: 12,
    color: '#fff',
    background: colors[status] || '#888',
    padding: '3px 8px',
    borderRadius: 10,
    textTransform: 'capitalize',
  };
}

const styles = {
  page: { maxWidth: 700, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' },
  back: { background: 'none', border: 'none', color: '#4f46e5', cursor: 'pointer', marginBottom: 12, padding: 0 },
  h1: { fontSize: 22, marginBottom: 4 },
  h2: { fontSize: 16, marginBottom: 12 },
  card: { background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: 16, marginBottom: 16 },
  stepRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 0',
    borderBottom: '1px solid #f5f5f5',
    fontSize: 13,
  },
  stepOrder: { fontWeight: 'bold', color: '#aaa' },
  stepType: { fontWeight: 'bold', textTransform: 'capitalize' },
  stepConfig: { color: '#888', fontSize: 12 },
  form: { display: 'flex', gap: 8, marginTop: 12 },
  select: { padding: 8, borderRadius: 6, border: '1px solid #ddd', fontSize: 14 },
  button: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' },
  runButton: {
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 20px',
    fontSize: 15,
    cursor: 'pointer',
  },
  approveButton: {
    background: '#d97706',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  },
};
