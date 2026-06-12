import { useState } from 'react';
import { api, qs } from '../api.js';
import { useAsync, useDebounced } from '../hooks.js';
import { fmtMoney, suggestedPrice, timeAgo, variantLabel } from '../utils.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Modal from '../components/Modal.jsx';
import CardForm from '../components/CardForm.jsx';

const SORTS = {
  name: 'Card',
  set_name: 'Set',
  quantity: 'Qty',
  cost_basis: 'Cost',
  market_price: 'Market',
  created_at: 'Added',
};

function ShowSelect({ shows, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No show (off-show sale/buy)</option>
      {shows.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
          {s.date ? ` — ${String(s.date).slice(0, 10)}` : ''}
        </option>
      ))}
    </select>
  );
}

// POST /api/cards/:id/sell
function SellModal({ card, pct, shows, onClose, onDone }) {
  const suggested = suggestedPrice(card.market_price, pct);
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(suggested ?? '');
  const [showId, setShowId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const total = (parseInt(quantity, 10) || 0) * (Number(unitPrice) || 0);

  const submit = async (e) => {
    e.preventDefault();
    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1) return setError(new Error('Quantity must be at least 1.'));
    if (qty > card.quantity)
      return setError(new Error(`Only ${card.quantity} in stock — can't sell ${qty}.`));
    if (unitPrice === '' || Number(unitPrice) < 0)
      return setError(new Error('Enter a sale price per card.'));
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/cards/${card.id}/sell`, {
        quantity: qty,
        unit_price: Number(unitPrice),
        show_id: showId ? Number(showId) : undefined,
        notes: notes.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Sell — ${card.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <div className="form-grid">
          <label className="field">
            <span>Quantity (in stock: {card.quantity})</span>
            <input
              type="number" min="1" max={card.quantity} step="1"
              value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus
            />
          </label>
          <label className="field">
            <span>Price per card ($)</span>
            <input
              type="number" min="0" step="0.01"
              value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)}
            />
            {suggested != null && (
              <span className="field-hint">
                Suggested: <b className="your-price">{fmtMoney(suggested)}</b> ({pct}% of market)
              </span>
            )}
          </label>
          <label className="field full">
            <span>Show (optional)</span>
            <ShowSelect shows={shows} value={showId} onChange={setShowId} />
          </label>
          <label className="field full">
            <span>Notes (optional)</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. bundle deal" />
          </label>
        </div>
        <div className="modal-actions">
          <span className="modal-total">Total: <b>{fmtMoney(total)}</b></span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Selling…' : 'Record sale'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// POST /api/cards/:id/restock
function RestockModal({ card, shows, onClose, onDone }) {
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState(card.cost_basis ?? '');
  const [showId, setShowId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1) return setError(new Error('Quantity must be at least 1.'));
    if (unitCost === '' || Number(unitCost) < 0)
      return setError(new Error('Enter what you paid per card.'));
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/cards/${card.id}/restock`, {
        quantity: qty,
        unit_cost: Number(unitCost),
        show_id: showId ? Number(showId) : undefined,
      });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Restock — ${card.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <div className="form-grid">
          <label className="field">
            <span>Quantity to add</span>
            <input
              type="number" min="1" step="1"
              value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus
            />
          </label>
          <label className="field">
            <span>Cost per card ($)</span>
            <input
              type="number" min="0" step="0.01"
              value={unitCost} onChange={(e) => setUnitCost(e.target.value)}
            />
            <span className="field-hint">Cost basis becomes the weighted average.</span>
          </label>
          <label className="field full">
            <span>Show (optional)</span>
            <ShowSelect shows={shows} value={showId} onChange={setShowId} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add stock'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Inventory() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState('desc');

  const cards = useAsync(
    () => api.get(`/api/cards${qs({ search: debouncedSearch, sort, order })}`),
    [debouncedSearch, sort, order]
  );
  const settings = useAsync(() => api.get('/api/settings'), []);
  const showsData = useAsync(() => api.get('/api/shows'), []);

  const pct = Number(settings.data?.sell_percentage) || 80;
  const shows = showsData.data?.shows || [];

  const [modal, setModal] = useState(null); // { kind, card? }
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const toggleSort = (key) => {
    if (sort === key) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setOrder(['name', 'set_name'].includes(key) ? 'asc' : 'desc');
    }
  };

  const refreshPrice = async (card) => {
    setBusyId(card.id);
    setActionError(null);
    try {
      await api.post(`/api/cards/${card.id}/refresh-price`);
      cards.reload();
    } catch (err) {
      setActionError(
        err.status === 502
          ? new Error(`Couldn't refresh “${card.name}” — the price service is unavailable. (${err.message})`)
          : err
      );
    } finally {
      setBusyId(null);
    }
  };

  const deleteCard = async (card) => {
    if (
      !window.confirm(
        `Delete “${card.name}” from inventory?\n\nIts transaction history is kept, but the card row is gone for good.`
      )
    )
      return;
    setActionError(null);
    try {
      await api.del(`/api/cards/${card.id}`);
      cards.reload();
    } catch (err) {
      setActionError(err);
    }
  };

  const closeAndReload = () => {
    setModal(null);
    cards.reload();
  };

  const rows = cards.data?.cards || [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inventory</h1>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'add' })}>
          + Add card manually
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="search-input search-input-sm"
          placeholder="Search name, set, or card number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {cards.data && (
          <span className="muted nowrap">
            {cards.data.count} card{cards.data.count === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <ErrorBanner error={actionError} />
      {settings.error && (
        <ErrorBanner
          error={`Couldn't load settings (using ${pct}% for your price): ${settings.error.message}`}
          onRetry={settings.reload}
        />
      )}

      {cards.loading && !cards.data ? (
        <Loading label="Loading inventory…" />
      ) : cards.error ? (
        <ErrorBanner error={cards.error} onRetry={cards.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🗃️"
          title={debouncedSearch ? `Nothing matches “${debouncedSearch}”` : 'No cards yet'}
          hint={
            debouncedSearch
              ? 'Try a different search.'
              : 'Add cards from Price Lookup (with live market prices) or use “Add card manually”.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table inventory-table">
            <thead>
              <tr>
                <th />
                {Object.entries(SORTS).slice(0, 2).map(([key, label]) => (
                  <th key={key} className="sortable" onClick={() => toggleSort(key)}>
                    {label} {sort === key ? (order === 'asc' ? '▲' : '▼') : ''}
                  </th>
                ))}
                <th>#</th>
                <th>Variant</th>
                <th>Cond.</th>
                <th className="num sortable" onClick={() => toggleSort('quantity')}>
                  Qty {sort === 'quantity' ? (order === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th className="num sortable" onClick={() => toggleSort('cost_basis')}>
                  Cost {sort === 'cost_basis' ? (order === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th className="num sortable" onClick={() => toggleSort('market_price')}>
                  Market {sort === 'market_price' ? (order === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th className="num">Your price</th>
                <th className="num">Value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((card) => {
                const yourPrice = suggestedPrice(card.market_price, pct);
                const value =
                  card.market_price != null ? card.quantity * card.market_price : null;
                return (
                  <tr key={card.id} className={card.quantity === 0 ? 'dimmed' : ''}>
                    <td>
                      {card.image_url ? (
                        <img className="thumb" src={card.image_url} alt="" loading="lazy" />
                      ) : (
                        <span className="thumb thumb-placeholder">🎴</span>
                      )}
                    </td>
                    <td>
                      <div className="cell-title">{card.name}</div>
                      {card.quantity === 0 && <div className="cell-sub neg">out of stock</div>}
                    </td>
                    <td>{card.set_name || '—'}</td>
                    <td className="nowrap">{card.card_number || '—'}</td>
                    <td className="nowrap">{variantLabel(card.variant)}</td>
                    <td>{card.condition || '—'}</td>
                    <td className="num">{card.quantity}</td>
                    <td className="num">{fmtMoney(card.cost_basis)}</td>
                    <td className="num">
                      {fmtMoney(card.market_price)}
                      {card.price_updated_at && (
                        <div className="cell-sub" title="Price last refreshed">
                          {timeAgo(card.price_updated_at)}
                        </div>
                      )}
                    </td>
                    <td className="num your-price">{fmtMoney(yourPrice)}</td>
                    <td className="num">{fmtMoney(value)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={card.quantity === 0}
                          onClick={() => setModal({ kind: 'sell', card })}
                        >
                          Sell
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setModal({ kind: 'restock', card })}
                        >
                          Restock
                        </button>
                        {card.tcg_card_id && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            title="Refresh market price from TCG API"
                            disabled={busyId === card.id}
                            onClick={() => refreshPrice(card)}
                          >
                            {busyId === card.id ? '…' : '↻'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm"
                          title="Edit card"
                          onClick={() => setModal({ kind: 'edit', card })}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-ghost"
                          title="Delete card"
                          onClick={() => deleteCard(card)}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === 'sell' && (
        <SellModal
          card={modal.card}
          pct={pct}
          shows={shows}
          onClose={() => setModal(null)}
          onDone={closeAndReload}
        />
      )}
      {modal?.kind === 'restock' && (
        <RestockModal
          card={modal.card}
          shows={shows}
          onClose={() => setModal(null)}
          onDone={closeAndReload}
        />
      )}
      {modal?.kind === 'edit' && (
        <Modal title={`Edit — ${modal.card.name}`} onClose={() => setModal(null)} wide>
          <CardForm
            mode="edit"
            initial={modal.card}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.patch(`/api/cards/${modal.card.id}`, payload);
              closeAndReload();
            }}
          />
        </Modal>
      )}
      {modal?.kind === 'add' && (
        <Modal title="Add card manually" onClose={() => setModal(null)} wide>
          <CardForm
            mode="add"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.post('/api/cards', payload);
              closeAndReload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
