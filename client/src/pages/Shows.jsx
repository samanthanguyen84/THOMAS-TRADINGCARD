import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { fmtDate, fmtMoney } from '../utils.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Modal from '../components/Modal.jsx';
import ShowForm from '../components/ShowForm.jsx';

export default function Shows() {
  const shows = useAsync(() => api.get('/api/shows'), []);
  const [creating, setCreating] = useState(false);

  const list = shows.data?.shows || [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Shows</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          + New show
        </button>
      </div>

      {shows.loading && !shows.data ? (
        <Loading label="Loading shows…" />
      ) : shows.error ? (
        <ErrorBanner error={shows.error} onRetry={shows.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          icon="🎪"
          title="No shows yet"
          hint="Create a show before the weekend, then tag sales and expenses to it to see per-show profit."
        />
      ) : (
        <div className="show-grid">
          {list.map((show) => {
            const spent = (show.purchases_total || 0) + (show.expenses_total || 0);
            return (
              <Link to={`/shows/${show.id}`} className="show-card" key={show.id}>
                <div className="show-card-head">
                  <div className="show-name">{show.name}</div>
                  <div className={`show-net ${show.net < 0 ? 'neg' : 'pos'}`}>
                    {fmtMoney(show.net, { sign: true })}
                  </div>
                </div>
                <div className="show-meta">
                  {fmtDate(show.date)}
                  {show.venue ? ` · ${show.venue}` : ''}
                </div>
                <div className="show-stats">
                  <span>
                    Sales <b className="pos">{fmtMoney(show.sales_total)}</b>
                  </span>
                  <span>
                    Spent <b className="neg">{fmtMoney(spent)}</b>
                  </span>
                  <span>
                    Table fee <b>{fmtMoney(show.table_fee)}</b>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {creating && (
        <Modal title="New show" onClose={() => setCreating(false)}>
          <ShowForm
            mode="add"
            onCancel={() => setCreating(false)}
            onSubmit={async (payload) => {
              await api.post('/api/shows', payload);
              setCreating(false);
              shows.reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
