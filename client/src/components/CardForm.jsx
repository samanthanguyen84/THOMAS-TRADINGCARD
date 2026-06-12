import { useState } from 'react';
import { CONDITIONS, VARIANTS, variantLabel } from '../utils.js';
import ErrorBanner from './ErrorBanner.jsx';

// Full card form used for "Add card manually" (POST /api/cards) and
// Edit (PATCH /api/cards/:id). The parent supplies onSubmit(payload).
export default function CardForm({ initial = {}, mode = 'add', onSubmit, onCancel }) {
  const [form, setForm] = useState({
    name: initial.name || '',
    set_name: initial.set_name || '',
    card_number: initial.card_number || '',
    variant: initial.variant || 'normal',
    condition: initial.condition || 'NM',
    quantity: initial.quantity ?? (mode === 'add' ? 1 : 0),
    cost_basis: initial.cost_basis ?? '',
    market_price: initial.market_price ?? '',
    image_url: initial.image_url || '',
    tcg_card_id: initial.tcg_card_id || '',
    notes: initial.notes || '',
    log_purchase: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(new Error('Card name is required.'));
      return;
    }
    const quantity = Math.max(0, parseInt(form.quantity, 10) || 0);
    const payload = {
      name: form.name.trim(),
      set_name: form.set_name.trim(),
      card_number: form.card_number.trim(),
      variant: form.variant.trim() || 'normal',
      condition: form.condition.trim() || 'NM',
      quantity,
      cost_basis: Math.max(0, Number(form.cost_basis) || 0),
      market_price:
        form.market_price === '' || form.market_price === null
          ? mode === 'edit'
            ? null
            : undefined
          : Number(form.market_price),
      image_url: form.image_url.trim(),
      tcg_card_id: form.tcg_card_id.trim(),
      notes: form.notes.trim(),
    };
    if (mode === 'add') payload.log_purchase = !!form.log_purchase;

    setBusy(true);
    setError(null);
    try {
      await onSubmit(payload);
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
          <input value={form.name} onChange={set('name')} placeholder="Charizard" required />
        </label>
        <label className="field">
          <span>Set</span>
          <input value={form.set_name} onChange={set('set_name')} placeholder="Base" />
        </label>
        <label className="field">
          <span>Card #</span>
          <input value={form.card_number} onChange={set('card_number')} placeholder="4" />
        </label>
        <label className="field">
          <span>Variant</span>
          <input list="variant-options" value={form.variant} onChange={set('variant')} />
          <datalist id="variant-options">
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                {variantLabel(v)}
              </option>
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Condition</span>
          <select value={form.condition} onChange={set('condition')}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {!CONDITIONS.includes(form.condition) && (
              <option value={form.condition}>{form.condition}</option>
            )}
          </select>
        </label>
        <label className="field">
          <span>Quantity</span>
          <input type="number" min="0" step="1" value={form.quantity} onChange={set('quantity')} />
        </label>
        <label className="field">
          <span>Cost per card ($)</span>
          <input type="number" min="0" step="0.01" value={form.cost_basis} onChange={set('cost_basis')} />
        </label>
        <label className="field">
          <span>Market price ($)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.market_price ?? ''}
            onChange={set('market_price')}
            placeholder="optional"
          />
        </label>
        <label className="field">
          <span>TCG card ID</span>
          <input value={form.tcg_card_id} onChange={set('tcg_card_id')} placeholder="base1-4" />
        </label>
        <label className="field full">
          <span>Image URL</span>
          <input value={form.image_url} onChange={set('image_url')} placeholder="https://…" />
        </label>
        <label className="field full">
          <span>Notes</span>
          <textarea rows="2" value={form.notes} onChange={set('notes')} />
        </label>
        {mode === 'add' && (
          <label className="field-check full">
            <input type="checkbox" checked={form.log_purchase} onChange={set('log_purchase')} />
            <span>Log a purchase transaction for this quantity (counts toward money spent)</span>
          </label>
        )}
      </div>
      <div className="modal-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : mode === 'add' ? 'Add card' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
