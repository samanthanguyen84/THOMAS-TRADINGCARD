import { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { AlertsContext } from '../alertsContext.js';
import { fmtDateTime, timeAgo } from '../utils.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';

const RETAILERS = {
  target: {
    label: 'Target',
    cls: 'retailer-target',
    skuLabel: 'TCIN',
    hint: 'Use the TCIN — the number at the end of the product URL (target.com/p/…/A-93954435 → 93954435).',
  },
  bestbuy: {
    label: 'Best Buy',
    cls: 'retailer-bestbuy',
    skuLabel: 'SKU',
    hint: 'Use the SKU from the product page (under “Specifications”, also in the URL). Requires a Best Buy API key — set it in Settings.',
  },
  barnesnoble: {
    label: 'Barnes & Noble',
    cls: 'retailer-bn',
    skuLabel: 'EAN / ISBN',
    hint: 'Use the EAN/ISBN — the 13-digit number on the product page.',
  },
};

const STATUS = {
  in_stock: { label: 'In stock', cls: 'pill-green' },
  out_of_stock: { label: 'Out of stock', cls: 'pill-gray' },
  error: { label: 'Error', cls: 'pill-red' },
  unknown: { label: 'Unknown', cls: 'pill-yellow' },
};

// POST /api/watches
function AddWatchForm({ onSaved }) {
  const [retailer, setRetailer] = useState('target');
  const [sku, setSku] = useState('');
  const [productName, setProductName] = useState('');
  const [zip, setZip] = useState('');
  const [storeId, setStoreId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const info = RETAILERS[retailer];

  const submit = async (e) => {
    e.preventDefault();
    if (!sku.trim()) {
      setError(new Error(`Enter the ${info.skuLabel}.`));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/watches', {
        retailer,
        sku: sku.trim(),
        product_name: productName.trim() || undefined,
        zip_code: zip.trim() || undefined,
        store_id: storeId.trim() || undefined,
      });
      setSku('');
      setProductName('');
      setZip('');
      setStoreId('');
      onSaved();
      setBusy(false);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-head"><h2>Watch a product</h2></div>
      <ErrorBanner error={error} />
      <div className="form-grid form-grid-3">
        <label className="field">
          <span>Retailer</span>
          <select value={retailer} onChange={(e) => setRetailer(e.target.value)}>
            {Object.entries(RETAILERS).map(([key, r]) => (
              <option key={key} value={key}>{r.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{info.skuLabel} *</span>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder={retailer === 'barnesnoble' ? '9780000000000' : 'e.g. 93954435'}
          />
        </label>
        <label className="field">
          <span>Product name (for alerts)</span>
          <input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="Pokémon 151 ETB"
          />
        </label>
        <label className="field">
          <span>ZIP code (optional)</span>
          <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="62704" />
        </label>
        <label className="field">
          <span>Store ID (optional)</span>
          <input value={storeId} onChange={(e) => setStoreId(e.target.value)} />
        </label>
        <div className="field field-submit">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Start watching'}
          </button>
        </div>
      </div>
      <p className="field-hint retailer-hint">💡 {info.hint}</p>
    </form>
  );
}

export default function RestockWatch() {
  const watches = useAsync(() => api.get('/api/watches'), []);
  const alerts = useAsync(() => api.get('/api/alerts?limit=50'), []);
  const { refresh: refreshBadge } = useContext(AlertsContext);

  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [markingSeen, setMarkingSeen] = useState(false);

  const watchList = watches.data?.watches || [];
  const alertList = alerts.data?.alerts || [];
  const unseenCount = alertList.filter((a) => !a.seen).length;
  const bestBuyKeyIssue = watchList.some(
    (w) => w.retailer === 'bestbuy' && w.last_status === 'error'
  );

  const toggleActive = async (watch) => {
    setActionError(null);
    try {
      await api.patch(`/api/watches/${watch.id}`, { active: watch.active ? 0 : 1 });
      watches.reload();
    } catch (err) {
      setActionError(err);
    }
  };

  const checkNow = async (watch) => {
    setBusyId(watch.id);
    setActionError(null);
    try {
      await api.post(`/api/watches/${watch.id}/check`);
      watches.reload();
      alerts.reload();
      refreshBadge();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusyId(null);
    }
  };

  const deleteWatch = async (watch) => {
    if (
      !window.confirm(
        `Stop watching “${watch.product_name || watch.sku}”?\n\nIts alerts will be deleted too.`
      )
    )
      return;
    setActionError(null);
    try {
      await api.del(`/api/watches/${watch.id}`);
      watches.reload();
      alerts.reload();
      refreshBadge();
    } catch (err) {
      setActionError(err);
    }
  };

  const markAllSeen = async () => {
    setMarkingSeen(true);
    setActionError(null);
    try {
      await api.post('/api/alerts/mark-seen', {});
      alerts.reload();
      refreshBadge();
    } catch (err) {
      setActionError(err);
    } finally {
      setMarkingSeen(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Restock Watch</h1>
      </div>

      <AddWatchForm
        onSaved={() => {
          watches.reload();
        }}
      />

      <ErrorBanner error={actionError} />

      {bestBuyKeyIssue && (
        <div className="banner banner-warn">
          ⚠️ A Best Buy watch is failing. If you haven&rsquo;t added a Best Buy API key yet,
          set one in <Link to="/settings" className="link">Settings</Link>.
        </div>
      )}

      <section className="panel">
        <div className="panel-head"><h2>Watched products</h2></div>
        {watches.loading && !watches.data ? (
          <Loading label="Loading watches…" />
        ) : watches.error ? (
          <ErrorBanner error={watches.error} onRetry={watches.reload} />
        ) : watchList.length === 0 ? (
          <EmptyState
            icon="📦"
            title="Not watching anything yet"
            hint="Add a Target, Best Buy, or Barnes & Noble product above to get Discord restock alerts."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Retailer</th>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Status</th>
                  <th>Last checked</th>
                  <th>Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {watchList.map((watch) => {
                  const retailer = RETAILERS[watch.retailer] || { label: watch.retailer, cls: '' };
                  const status = STATUS[watch.last_status] || STATUS.unknown;
                  return (
                    <tr key={watch.id} className={watch.active ? '' : 'dimmed'}>
                      <td>
                        <span className={`retailer ${retailer.cls}`}>{retailer.label}</span>
                      </td>
                      <td>
                        <div className="cell-title">{watch.product_name || '—'}</div>
                        {watch.zip_code && <div className="cell-sub">ZIP {watch.zip_code}</div>}
                      </td>
                      <td className="mono">{watch.sku}</td>
                      <td>
                        <span className={`pill ${status.cls}`} title={watch.last_error || ''}>
                          {status.label}
                        </span>
                        {watch.last_status === 'error' && watch.last_error && (
                          <div className="cell-sub neg">{watch.last_error}</div>
                        )}
                      </td>
                      <td className="nowrap" title={fmtDateTime(watch.last_checked)}>
                        {watch.last_checked ? timeAgo(watch.last_checked) : 'never'}
                      </td>
                      <td>
                        <label className="switch" title={watch.active ? 'Watching' : 'Paused'}>
                          <input
                            type="checkbox"
                            checked={!!watch.active}
                            onChange={() => toggleActive(watch)}
                          />
                          <span className="slider" />
                        </label>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busyId === watch.id}
                            onClick={() => checkNow(watch)}
                          >
                            {busyId === watch.id ? 'Checking…' : 'Check now'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger-ghost"
                            onClick={() => deleteWatch(watch)}
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
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Alerts</h2>
          {unseenCount > 0 && (
            <button type="button" className="btn btn-sm" onClick={markAllSeen} disabled={markingSeen}>
              {markingSeen ? 'Marking…' : `Mark all seen (${unseenCount})`}
            </button>
          )}
        </div>
        {alerts.loading && !alerts.data ? (
          <Loading label="Loading alerts…" />
        ) : alerts.error ? (
          <ErrorBanner error={alerts.error} onRetry={alerts.reload} />
        ) : alertList.length === 0 ? (
          <EmptyState
            icon="🔔"
            title="No alerts yet"
            hint="When a watched product comes back in stock you'll get a Discord ping and see it here."
          />
        ) : (
          <ul className="list">
            {alertList.map((alert) => {
              const retailer = RETAILERS[alert.retailer] || { label: alert.retailer };
              return (
                <li className={`list-row${alert.seen ? '' : ' unseen'}`} key={alert.id}>
                  {!alert.seen && <span className="dot" title="Unseen" />}
                  <span className="list-main">
                    <span className="list-title">{alert.message}</span>
                    <span className="list-sub">
                      {retailer.label} · {alert.product_name || alert.sku} · {fmtDateTime(alert.created_at)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
