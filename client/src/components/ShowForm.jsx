import { useState } from 'react';
import { todayISO } from '../utils.js';
import ErrorBanner from './ErrorBanner.jsx';

// Create (POST /api/shows) and edit (PATCH /api/shows/:id) form.
export default function ShowForm({ initial = {}, mode = 'add', onSubmit, onCancel }) {
  const [form, setForm] = useState({
    name: initial.name || '',
    date: initial.date ? String(initial.date).slice(0, 10) : todayISO(),
    venue: initial.venue || '',
    table_fee: initial.table_fee ?? '',
    notes: initial.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(new Error('Show name is required.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: form.name.trim(),
        date: form.date || undefined,
        venue: form.venue.trim(),
        table_fee: Math.max(0, Number(form.table_fee) || 0),
        notes: form.notes.trim(),
      });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <ErrorBanner error={error} />
      <div className="form-grid">
        <label className="field full">
          <span>Name *</span>
          <input value={form.name} onChange={set('name')} placeholder="Springfield Card Show" required />
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={form.date} onChange={set('date')} />
        </label>
        <label className="field">
          <span>Table fee ($)</span>
          <input type="number" min="0" step="0.01" value={form.table_fee} onChange={set('table_fee')} />
        </label>
        <label className="field full">
          <span>Venue</span>
          <input value={form.venue} onChange={set('venue')} placeholder="Fairgrounds Hall B" />
        </label>
        <label className="field full">
          <span>Notes</span>
          <textarea rows="2" value={form.notes} onChange={set('notes')} />
        </label>
      </div>
      <div className="modal-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : mode === 'add' ? 'Create show' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
