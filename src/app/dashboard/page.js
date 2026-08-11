'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { gql, useQuery, useMutation } from '@apollo/client';
import { useAuthenticationStatus, useUserId } from '@nhost/react';
import { nhost } from '@/lib/nhost';

const MY_ORGS = gql`
  query MyOrgs($user_id: uuid!) {
    org_members(where: { user_id: { _eq: $user_id } }) {
      role
      organization {
        id
        name
        quota_limit
        quota_used
      }
    }
  }
`;

const WORKFLOWS_FOR_ORG = gql`
  query WorkflowsForOrg($org_id: uuid!) {
    workflows(where: { org_id: { _eq: $org_id } }, order_by: { created_at: desc }) {
      id
      name
      description
      workflow_runs(order_by: { started_at: desc }, limit: 1) {
        status
        started_at
      }
    }
  }
`;

const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($org_id: uuid!, $name: String!, $created_by: uuid!) {
    insert_workflows_one(object: { org_id: $org_id, name: $name, created_by: $created_by }) {
      id
    }
  }
`;

export default function Dashboard() {
  const { isAuthenticated, isLoading: authLoading } = useAuthenticationStatus();
  const userId = useUserId();
  const router = useRouter();
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [newWorkflowName, setNewWorkflowName] = useState('');

  const { data: orgsData, loading: orgsLoading } = useQuery(MY_ORGS, {
    variables: { user_id: userId },
    skip: !userId,
  });

  const memberships = orgsData?.org_members || [];
  const activeOrgId = selectedOrgId || memberships[0]?.organization.id;
  const activeMembership = memberships.find((m) => m.organization.id === activeOrgId);

  const { data: wfData, loading: wfLoading, refetch } = useQuery(WORKFLOWS_FOR_ORG, {
    variables: { org_id: activeOrgId },
    skip: !activeOrgId,
    pollInterval: 5000,
  });

  const [createWorkflow, { loading: creating }] = useMutation(CREATE_WORKFLOW);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/auth');
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || orgsLoading) {
    return <main style={styles.page}>Loading...</main>;
  }
  if (!isAuthenticated) {
    return <main style={styles.page}>Redirecting...</main>;
  }

  async function handleCreateWorkflow(e) {
    e.preventDefault();
    if (!newWorkflowName.trim()) return;
    const { data } = await createWorkflow({
      variables: { org_id: activeOrgId, name: newWorkflowName, created_by: userId },
    });
    setNewWorkflowName('');
    refetch();
    if (data?.insert_workflows_one?.id) {
      router.push(`/workflows/${data.insert_workflows_one.id}`);
    }
  }

  async function handleSignOut() {
    await nhost.auth.signOut();
    router.replace('/auth');
  }

  const canCreate = activeMembership && ['owner', 'editor'].includes(activeMembership.role);
  const org = activeMembership?.organization;

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>AI Workflow Builder</h1>
        <button onClick={handleSignOut} style={styles.signOut}>
          Sign Out
        </button>
      </header>

      <section style={styles.card}>
        <label style={styles.label}>Organization</label>
        <select
          value={activeOrgId || ''}
          onChange={(e) => setSelectedOrgId(e.target.value)}
          style={styles.select}
        >
          {memberships.map((m) => (
            <option key={m.organization.id} value={m.organization.id}>
              {m.organization.name} ({m.role})
            </option>
          ))}
        </select>

        {org && (
          <div style={styles.quota}>
            Quota used: <strong>{org.quota_used}</strong> / {org.quota_limit}
            <div style={styles.quotaBarOuter}>
              <div
                style={{
                  ...styles.quotaBarInner,
                  width: `${Math.min(100, (org.quota_used / org.quota_limit) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
      </section>

      {canCreate && (
        <section style={styles.card}>
          <form onSubmit={handleCreateWorkflow} style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="New workflow name"
              value={newWorkflowName}
              onChange={(e) => setNewWorkflowName(e.target.value)}
              style={{ ...styles.select, flex: 1 }}
            />
            <button type="submit" disabled={creating} style={styles.button}>
              {creating ? 'Creating...' : '+ New Workflow'}
            </button>
          </form>
        </section>
      )}

      <section style={styles.card}>
        <h2 style={styles.h2}>Workflows</h2>
        {wfLoading && <p>Loading workflows...</p>}
        {wfData?.workflows.length === 0 && <p>No workflows yet.</p>}
        <div>
          {wfData?.workflows.map((wf) => (
            <div
              key={wf.id}
              style={styles.workflowRow}
              onClick={() => router.push(`/workflows/${wf.id}`)}
            >
              <div>
                <strong>{wf.name}</strong>
                <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
                  {wf.description || 'No description'}
                </p>
              </div>
              <span style={styles.badge}>
                {wf.workflow_runs[0]?.status || 'never run'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const styles = {
  page: { maxWidth: 700, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  h1: { fontSize: 20 },
  h2: { fontSize: 16, marginBottom: 12 },
  signOut: { background: 'none', border: '1px solid #ddd', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' },
  card: { background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: 16, marginBottom: 16 },
  label: { display: 'block', fontSize: 13, color: '#666', marginBottom: 6 },
  select: { width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' },
  quota: { marginTop: 12, fontSize: 13 },
  quotaBarOuter: { background: '#eee', height: 8, borderRadius: 4, marginTop: 6 },
  quotaBarInner: { background: '#4f46e5', height: 8, borderRadius: 4 },
  button: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' },
  workflowRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid #f0f0f0',
    cursor: 'pointer',
  },
  badge: { fontSize: 12, background: '#f0f0f0', padding: '4px 8px', borderRadius: 12, textTransform: 'capitalize' },
};
