import { useState } from 'react';
import { api, qs } from '../api.js';
import { useAsync } from '../hooks.js';
import { fmtMoney, todayISO, txSigned } from '../utils.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import TransactionTable, { confirmDeleteTransaction } from '../components/TransactionTable.jsx';

const TYPE_CHIPS = ['all', 'sale', 'purchase', 'expense', 'adjustment'];

// Manual entry — table fees, gas, food, cash adjustments (POST /api/transactions).
function AddEntryForm({ shows, onSaved }) {
  const [type, setType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [showId, setShowId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const total = Number(amount);
    if (amount === '' || Number.isNaN(total)) {
      setError(new Error('Enter an amount.'));
      return;
    }
    if (type === 'expense' && total < 0) {
      setError(new Error('Expenses are entered as positive amounts — use an adjustment for negative corrections.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/transactions', {
        type,
        total,
        description: description.trim() || undefined,
        show_id: showId ? Number(showId) : undefined,
        date: date || undefined,
      });
      setAmount('');
      setDescription('');
      onSaved();
      setBusy(false);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-head">
        <h2>Add expense / adjustment</h2>
      </div>
      <ErrorBanner error={error} />
      <div className="form-grid form-grid-3">
        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="expense">Expense (gas, food, table fee…)</option>
            <option value="adjustment">Adjustment (cash correction, ±)</option>
          </select>
        </label>
        <label className="field">
          <span>Amount ($)</span>
          <input
            type="number"
            step="0.01"
            placeholder={type === 'adjustment' ? 'can be negative' : '0.00'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {type === 'adjustment' && (
            <span className="field-hint">Positive = money in, negative = money out.</span>
          )}
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Gas to Springfield show"
          />
        </label>
        <label className="field">
          <span>Show (optional)</span>
          <select value={showId} onChange={(e) => setShowId(e.target.value)}>
            <option value="">No show</option>
            {shows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.date ? ` — ${String(s.date).slice(0, 10)}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="field field-submit">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add entry'}
          </button>
        </div>
      </div>
    </form>
  );
}

export default function Sales() {
  const [type, setType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const tx = useAsync(
    () =>
      api.get(
        `/api/transactions${qs({ type: type === 'all' ? '' : type, from, to })}`
      ),
    [type, from, to]
  );
  const showsData = useAsync(() => api.get('/api/shows'), []);
  const shows = showsData.data?.shows || [];

  const [actionError, setActionError] = useState(null);

  const transactions = tx.data?.transactions || [];
  const moneyIn = transactions
    .filter((t) => txSigned(t) > 0)
    .reduce((sum, t) => sum + txSigned(t), 0);
  const moneyOut = transactions
    .filter((t) => txSigned(t) < 0)
    .reduce((sum, t) => sum + txSigned(t), 0);
  const net = moneyIn + moneyOut;

  const handleDelete = async (transaction) => {
    if (!confirmDeleteTransaction(transaction)) return;
    setActionError(null);
    try {
      await api.del(`/api/transactions/${transaction.id}`);
      tx.reload();
    } catch (err) {
      setActionError(err);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Sales &amp; Money</h1>
      </div>

      <AddEntryForm shows={shows} onSaved={() => tx.reload()} />

      <div className="toolbar toolbar-wrap">
        <div className="chips">
          {TYPE_CHIPS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${type === t ? ' active' : ''}`}
              onClick={() => setType(t)}
            >
              {t === 'all' ? 'All' : `${t}s`}
            </button>
          ))}
        </div>
        <div className="date-range">
          <label className="muted nowrap">
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="muted nowrap">
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {(from || to) && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <ErrorBanner error={actionError} />

      {tx.loading && !tx.data ? (
        <Loading label="Loading transactions…" />
      ) : tx.error ? (
        <ErrorBanner error={tx.error} onRetry={tx.reload} />
      ) : transactions.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="No transactions found"
          hint={
            type !== 'all' || from || to
              ? 'Try widening the filters above.'
              : 'Sell a card from Inventory, or add an expense above, and it shows up here.'
          }
        />
      ) : (
        <>
          <div className="totals-row">
            <span>
              In: <b className="pos">{fmtMoney(moneyIn, { sign: true })}</b>
            </span>
            <span>
              Out: <b className="neg">{fmtMoney(moneyOut, { sign: true })}</b>
            </span>
            <span>
              Net: <b className={net < 0 ? 'neg' : 'pos'}>{fmtMoney(net, { sign: true })}</b>
            </span>
            <span className="muted">
              {tx.data.count} transaction{tx.data.count === 1 ? '' : 's'}
            </span>
          </div>
          <TransactionTable transactions={transactions} onDelete={handleDelete} />
        </>
      )}
    </div>
  );
}
