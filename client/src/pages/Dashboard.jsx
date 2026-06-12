import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import {
  fmtDate,
  fmtMoney,
  monthLabel,
  monthLabelFull,
  timeAgo,
  txSigned,
} from '../utils.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';

function StatCards({ summary }) {
  const inv = summary.inventory || {};
  return (
    <div className="stat-grid">
      <div className="stat-card">
        <div className="stat-label">Net profit (all time)</div>
        <div className={`stat-value ${summary.net_profit < 0 ? 'neg' : 'pos'}`}>
          {fmtMoney(summary.net_profit)}
        </div>
        <div className="stat-sub">
          {summary.sales_count} sales · {summary.cards_sold} cards sold
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Sales total</div>
        <div className="stat-value">{fmtMoney(summary.sales_total)}</div>
        <div className="stat-sub">
          spent {fmtMoney(summary.purchases_total)} on cards · {fmtMoney(summary.expenses_total)} expenses
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Inventory market value</div>
        <div className="stat-value">{fmtMoney(inv.market_value)}</div>
        <div className="stat-sub">
          asking {fmtMoney(inv.asking_value)} at {summary.sell_percentage}% of market
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Cards in stock</div>
        <div className="stat-value">{inv.total_quantity ?? 0}</div>
        <div className="stat-sub">
          {inv.unique_cards ?? 0} unique · cost basis {fmtMoney(inv.cost_value)}
        </div>
      </div>
    </div>
  );
}

function MonthlyBars({ months }) {
  if (!months.length) return <EmptyState icon="📅" title="No activity yet" />;
  const max = Math.max(
    1,
    ...months.map((m) => Math.max(m.sales || 0, (m.purchases || 0) + (m.expenses || 0)))
  );
  return (
    <>
      <div className="bars">
        {months.map((m) => {
          const out = (m.purchases || 0) + (m.expenses || 0);
          return (
            <div
              className="bar-col"
              key={m.month}
              title={`${monthLabelFull(m.month)} — sales ${fmtMoney(m.sales)}, money out ${fmtMoney(out)}, net ${fmtMoney(m.net)}`}
            >
              <div className="bar-stack">
                <div
                  className="bar bar-sales"
                  style={{ height: `${Math.round(((m.sales || 0) / max) * 100)}%` }}
                />
                <div
                  className="bar bar-out"
                  style={{ height: `${Math.round((out / max) * 100)}%` }}
                />
              </div>
              <div className="bar-label">{monthLabel(m.month)}</div>
              <div className={`bar-net ${m.net < 0 ? 'neg' : 'pos'}`}>{fmtMoney(m.net)}</div>
            </div>
          );
        })}
      </div>
      <div className="bar-legend">
        <span><i className="swatch swatch-sales" /> Sales</span>
        <span><i className="swatch swatch-out" /> Money out</span>
      </div>
    </>
  );
}

function Section({ title, action, state, render, emptyIcon, emptyTitle, emptyHint }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {state.loading && !state.data ? (
        <Loading />
      ) : state.error ? (
        <ErrorBanner error={state.error} onRetry={state.reload} />
      ) : (
        render(state.data) ?? (
          <EmptyState icon={emptyIcon} title={emptyTitle} hint={emptyHint} />
        )
      )}
    </section>
  );
}

export default function Dashboard() {
  const summary = useAsync(() => api.get('/api/reports/summary'), []);
  const monthly = useAsync(() => api.get('/api/reports/monthly?months=12'), []);
  const topCards = useAsync(() => api.get('/api/reports/top-cards?limit=8'), []);
  const recent = useAsync(() => api.get('/api/transactions?limit=10'), []);
  const alerts = useAsync(() => api.get('/api/alerts?limit=5'), []);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <Link to="/prices" className="btn btn-primary">🔎 Price Lookup</Link>
      </div>

      {summary.loading && !summary.data ? (
        <Loading label="Loading summary…" />
      ) : summary.error ? (
        <ErrorBanner error={summary.error} onRetry={summary.reload} />
      ) : (
        summary.data && <StatCards summary={summary.data} />
      )}

      <Section
        title="Last 12 months"
        state={monthly}
        render={(data) =>
          data?.months?.length ? <MonthlyBars months={data.months} /> : null
        }
        emptyIcon="📅"
        emptyTitle="No monthly data yet"
        emptyHint="Sales and purchases will show up here month by month."
      />

      <div className="grid-2">
        <Section
          title="Top sellers"
          state={topCards}
          render={(data) =>
            data?.top_cards?.length ? (
              <ul className="list">
                {data.top_cards.map((c, i) => (
                  <li className="list-row" key={c.card_id ?? `${c.name}-${i}`}>
                    <span className="rank">#{i + 1}</span>
                    <span className="list-main">
                      <span className="list-title">{c.name}</span>
                      <span className="list-sub">{c.set_name || '—'} · {c.qty_sold} sold</span>
                    </span>
                    <span className="list-end">
                      <span className="list-title">{fmtMoney(c.revenue)}</span>
                      <span className={`list-sub ${c.profit < 0 ? 'neg' : 'pos'}`}>
                        {fmtMoney(c.profit, { sign: true })} profit
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null
          }
          emptyIcon="🏆"
          emptyTitle="No sales yet"
          emptyHint="Your best-selling cards will rank here."
        />

        <Section
          title="Recent transactions"
          action={<Link className="link" to="/money">View all →</Link>}
          state={recent}
          render={(data) =>
            data?.transactions?.length ? (
              <ul className="list">
                {data.transactions.map((tx) => {
                  const signed = txSigned(tx);
                  return (
                    <li className="list-row" key={tx.id}>
                      <span className={`pill pill-${tx.type}`}>{tx.type}</span>
                      <span className="list-main">
                        <span className="list-title">{tx.description || tx.card_name || '—'}</span>
                        <span className="list-sub">
                          {fmtDate(tx.date)}
                          {tx.show_name ? ` · ${tx.show_name}` : ''}
                        </span>
                      </span>
                      <span className={`amount ${signed < 0 ? 'neg' : 'pos'}`}>
                        {fmtMoney(signed, { sign: true })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null
          }
          emptyIcon="🧾"
          emptyTitle="No transactions yet"
          emptyHint="Sales and purchases will appear here as you record them."
        />
      </div>

      <Section
        title="Latest restock alerts"
        action={<Link className="link" to="/watch">Restock Watch →</Link>}
        state={alerts}
        render={(data) =>
          data?.alerts?.length ? (
            <ul className="list">
              {data.alerts.map((a) => (
                <li className="list-row" key={a.id}>
                  {!a.seen && <span className="dot" title="Unseen" />}
                  <span className="list-main">
                    <span className="list-title">{a.message}</span>
                    <span className="list-sub">
                      {a.retailer} · {a.product_name || a.sku} · {timeAgo(a.created_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null
        }
        emptyIcon="📦"
        emptyTitle="No alerts yet"
        emptyHint="Add retail watches and you'll see restock alerts here."
      />
    </div>
  );
}
