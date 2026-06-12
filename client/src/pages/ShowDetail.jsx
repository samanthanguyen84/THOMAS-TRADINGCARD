import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { fmtDate, fmtMoney } from '../utils.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Modal from '../components/Modal.jsx';
import ShowForm from '../components/ShowForm.jsx';
import TransactionTable, { confirmDeleteTransaction } from '../components/TransactionTable.jsx';

export default function ShowDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const show = useAsync(() => api.get(`/api/shows/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState(null);

  const data = show.data;

  const deleteShow = async () => {
    if (
      !window.confirm(
        `Delete “${data.name}”?\n\nIts transactions are kept, but they'll no longer be linked to a show.`
      )
    )
      return;
    setActionError(null);
    try {
      await api.del(`/api/shows/${id}`);
      navigate('/shows');
    } catch (err) {
      setActionError(err);
    }
  };

  const deleteTransaction = async (tx) => {
    if (!confirmDeleteTransaction(tx)) return;
    setActionError(null);
    try {
      await api.del(`/api/transactions/${tx.id}`);
      show.reload();
    } catch (err) {
      setActionError(err);
    }
  };

  if (show.loading && !data) return <div className="page"><Loading label="Loading show…" /></div>;
  if (show.error)
    return (
      <div className="page">
        <Link className="link" to="/shows">← All shows</Link>
        <ErrorBanner error={show.error} onRetry={show.reload} />
      </div>
    );
  if (!data) return null;

  const spent = (data.purchases_total || 0) + (data.expenses_total || 0);

  return (
    <div className="page">
      <Link className="link" to="/shows">← All shows</Link>
      <div className="page-head">
        <div>
          <h1>{data.name}</h1>
          <div className="muted">
            {fmtDate(data.date)}
            {data.venue ? ` · ${data.venue}` : ''}
          </div>
        </div>
        <div className="row-actions">
          <button type="button" className="btn" onClick={() => setEditing(true)}>✏️ Edit</button>
          <button type="button" className="btn btn-danger-ghost" onClick={deleteShow}>🗑 Delete</button>
        </div>
      </div>

      <ErrorBanner error={actionError} />

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>P&amp;L breakdown</h2></div>
          <ul className="pl-list">
            <li><span>Sales</span><b className="pos">{fmtMoney(data.sales_total, { sign: true })}</b></li>
            <li><span>Cards bought</span><b className="neg">{fmtMoney(-(data.purchases_total || 0), { sign: true })}</b></li>
            <li><span>Expenses</span><b className="neg">{fmtMoney(-(data.expenses_total || 0), { sign: true })}</b></li>
            <li><span>Table fee</span><b className="neg">{fmtMoney(-(data.table_fee || 0), { sign: true })}</b></li>
            <li className="pl-net">
              <span>Net</span>
              <b className={data.net < 0 ? 'neg' : 'pos'}>{fmtMoney(data.net, { sign: true })}</b>
            </li>
          </ul>
          <div className="muted pl-foot">Total spent at this show: {fmtMoney(spent + (data.table_fee || 0))}</div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Details</h2></div>
          <ul className="kv-list">
            <li><span>Date</span><b>{fmtDate(data.date)}</b></li>
            <li><span>Venue</span><b>{data.venue || '—'}</b></li>
            <li><span>Table fee</span><b>{fmtMoney(data.table_fee)}</b></li>
            <li><span>Notes</span><b>{data.notes || '—'}</b></li>
          </ul>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Transactions at this show</h2></div>
        {(data.transactions || []).length === 0 ? (
          <EmptyState
            icon="🧾"
            title="Nothing recorded yet"
            hint="Pick this show when selling from Inventory or adding expenses, and it'll show here."
          />
        ) : (
          <TransactionTable
            transactions={data.transactions}
            showShowColumn={false}
            onDelete={deleteTransaction}
          />
        )}
      </section>

      {editing && (
        <Modal title={`Edit — ${data.name}`} onClose={() => setEditing(false)}>
          <ShowForm
            mode="edit"
            initial={data}
            onCancel={() => setEditing(false)}
            onSubmit={async (payload) => {
              await api.patch(`/api/shows/${id}`, payload);
              setEditing(false);
              show.reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
