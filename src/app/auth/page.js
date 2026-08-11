'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { nhost } from '@/lib/nhost';

export default function AuthPage() {
  const [mode, setMode] = useState('signin'); // 'signin' or 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        const { error } = await nhost.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await nhost.auth.signIn({ email, password });
        if (error) throw error;
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>AI Workflow Builder</h1>
        <div style={styles.tabs}>
          <button
            onClick={() => setMode('signin')}
            style={mode === 'signin' ? styles.tabActive : styles.tab}
          >
            Sign In
          </button>
          <button
            onClick={() => setMode('signup')}
            style={mode === 'signup' ? styles.tabActive : styles.tab}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={styles.input}
          />
          <input
            type="password"
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={styles.input}
          />
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
        </form>
      </div>
    </main>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f4f5f7',
    fontFamily: 'sans-serif',
  },
  card: {
    background: '#fff',
    padding: 32,
    borderRadius: 12,
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    width: 360,
  },
  title: { marginBottom: 20, fontSize: 22 },
  tabs: { display: 'flex', marginBottom: 20, borderBottom: '1px solid #eee' },
  tab: {
    flex: 1,
    padding: 10,
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    color: '#888',
  },
  tabActive: {
    flex: 1,
    padding: 10,
    background: 'none',
    border: 'none',
    borderBottom: '2px solid #4f46e5',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  input: {
    width: '100%',
    padding: 10,
    marginBottom: 12,
    borderRadius: 6,
    border: '1px solid #ddd',
    fontSize: 14,
    boxSizing: 'border-box',
  },
  button: {
    width: '100%',
    padding: 12,
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 15,
    cursor: 'pointer',
  },
  error: { color: '#d33', fontSize: 13, marginBottom: 10 },
};
