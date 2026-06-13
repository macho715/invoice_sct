'use client';

import React, { useState } from 'react';

export default function FxPoliciesPage() {
  const [formData, setFormData] = useState({
    fx_policy_id: `pol_${Math.random().toString(36).substring(2, 8)}`,
    from_currency: 'AED',
    to_currency: 'USD',
    fx_rate: 0.2723,
    rate_date: new Date().toISOString().slice(0, 16),
    valid_from: new Date().toISOString().slice(0, 16),
    valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
    approved_by: 'FINANCE_APPROVER',
    proof_hash: '59c632832860b7e4112e4318c66e2c366ff851210817c805cd7827e805cd82f1'
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    // Convert local datetime inputs to ISO datetime format required by the Zod schema
    const payload = {
      ...formData,
      fx_rate: Number(formData.fx_rate),
      rate_date: new Date(formData.rate_date).toISOString(),
      valid_from: new Date(formData.valid_from).toISOString(),
      valid_to: new Date(formData.valid_to).toISOString()
    };

    try {
      const response = await fetch('/api/fx-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ type: 'success', text: `Policy '${data.fx_policy.fx_policy_id}' registered successfully!` });
        setFormData(prev => ({
          ...prev,
          fx_policy_id: `pol_${Math.random().toString(36).substring(2, 8)}`
        }));
      } else {
        setMessage({ type: 'error', text: data.message || 'Validation failed' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.outerContainer}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet" />
      <div style={styles.glassCard}>
        <h1 style={styles.title}>Register Exchange Rate Policy</h1>
        <p style={styles.subtitle}>SCT Ontology Invoice Audit Platform — FxPolicy Flow</p>

        {message && (
          <div style={{
            ...styles.alert,
            background: message.type === 'success' ? 'rgba(74, 222, 128, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: message.type === 'success' ? '1px solid #4ade80' : '1px solid #ef4444',
            color: message.type === 'success' ? '#4ade80' : '#f87171'
          }}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.grid}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Policy ID</label>
              <input
                type="text"
                value={formData.fx_policy_id}
                onChange={e => setFormData({ ...formData, fx_policy_id: e.target.value })}
                style={styles.input}
                required
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Approved By</label>
              <input
                type="text"
                value={formData.approved_by}
                onChange={e => setFormData({ ...formData, approved_by: e.target.value })}
                style={styles.input}
                required
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>From Currency</label>
              <select
                value={formData.from_currency}
                onChange={e => setFormData({ ...formData, from_currency: e.target.value })}
                style={styles.select}
              >
                <option value="AED">AED</option>
                <option value="USD">USD</option>
              </select>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>To Currency</label>
              <select
                value={formData.to_currency}
                onChange={e => setFormData({ ...formData, to_currency: e.target.value })}
                style={styles.select}
              >
                <option value="USD">USD</option>
                <option value="AED">AED</option>
              </select>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Exchange Rate</label>
              <input
                type="number"
                step="0.0001"
                value={formData.fx_rate}
                onChange={e => setFormData({ ...formData, fx_rate: Number(e.target.value) })}
                style={styles.input}
                required
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Rate Reference Date</label>
              <input
                type="datetime-local"
                value={formData.rate_date}
                onChange={e => setFormData({ ...formData, rate_date: e.target.value })}
                style={styles.input}
                required
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Valid From</label>
              <input
                type="datetime-local"
                value={formData.valid_from}
                onChange={e => setFormData({ ...formData, valid_from: e.target.value })}
                style={styles.input}
                required
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Valid To</label>
              <input
                type="datetime-local"
                value={formData.valid_to}
                onChange={e => setFormData({ ...formData, valid_to: e.target.value })}
                style={styles.input}
                required
              />
            </div>
          </div>

          <div style={styles.inputGroupFull}>
            <label style={styles.label}>Proof Hash (SHA256)</label>
            <input
              type="text"
              value={formData.proof_hash}
              onChange={e => setFormData({ ...formData, proof_hash: e.target.value })}
              style={styles.input}
              required
            />
          </div>

          <button type="submit" disabled={loading} style={styles.submitBtn}>
            {loading ? 'Registering...' : 'Register Policy'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  outerContainer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'radial-gradient(circle at top left, #1e293b, #0f172a)',
    fontFamily: '"Outfit", sans-serif',
    padding: '40px 20px'
  },
  glassCard: {
    width: '100%',
    maxWidth: '800px',
    background: 'rgba(30, 41, 59, 0.7)',
    backdropFilter: 'blur(16px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '16px',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
    padding: '40px',
    color: '#f8fafc'
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    background: 'linear-gradient(to right, #38bdf8, #818cf8)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    margin: '0 0 10px 0',
    textAlign: 'center'
  },
  subtitle: {
    fontSize: '14px',
    color: '#94a3b8',
    margin: '0 0 30px 0',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: '1px'
  },
  alert: {
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '24px',
    fontSize: '14px',
    fontWeight: '500',
    textAlign: 'center'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '20px'
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  inputGroupFull: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%'
  },
  label: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#cbd5e1',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  input: {
    background: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '8px',
    color: '#f8fafc',
    padding: '12px 16px',
    fontSize: '14px',
    outline: 'none',
    transition: 'all 0.3s ease'
  },
  select: {
    background: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '8px',
    color: '#f8fafc',
    padding: '12px 16px',
    fontSize: '14px',
    outline: 'none',
    cursor: 'pointer'
  },
  submitBtn: {
    background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    marginTop: '10px',
    boxShadow: '0 4px 14px 0 rgba(79, 70, 229, 0.4)'
  }
};
