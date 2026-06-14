import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../api.js';
import { CONDITIONS, fmtMoney, variantLabel } from '../utils.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Modal from '../components/Modal.jsx';

const PAGE_SIZE = 20;

// Downscale a photo to a JPEG data URL before upload — keeps the payload small
// (and the vision call fast/cheap) without losing the legibility of the card text.
function fileToScaledDataUrl(file, maxEdge = 1024, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

// Small "Add to inventory" form, prefilled from a price-search result.
// POSTs /api/cards with name/set/number/variant/market_price/image/tcg id.
function AddToInventoryModal({ card, variant, market, suggested, onClose, onAdded }) {
  const [quantity, setQuantity] = useState(1);
  const [cost, setCost] = useState('');
  const [condition, setCondition] = useState('NM');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1) {
      setError(new Error('Quantity must be at least 1.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/cards', {
        name: card.name,
        set_name: card.set_name,
        card_number: card.card_number,
        variant,
        condition,
        quantity: qty,
        cost_basis: Math.max(0, Number(cost) || 0),
        market_price: market ?? undefined,
        image_url: card.image_url,
        tcg_card_id: card.tcg_card_id,
      });
      onAdded(qty);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title="Add to inventory" onClose={onClose}>
      <div className="add-preview">
        {card.image_url && <img src={card.image_url} alt="" className="add-preview-img" />}
        <div>
          <div className="list-title">{card.name}</div>
          <div className="list-sub">
            {card.set_name} · #{card.card_number} · {variantLabel(variant)}
          </div>
          <div className="add-preview-prices">
            <span>Market {fmtMoney(market)}</span>
            {suggested != null && (
              <span className="your-price">Your price {fmtMoney(suggested)}</span>
            )}
          </div>
        </div>
      </div>
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <div className="form-grid form-grid-3">
          <label className="field">
            <span>Quantity</span>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Cost paid / card ($)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Condition</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add to inventory'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function PriceLookup() {
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(null); // { card, variant, market, suggested }
  const [notice, setNotice] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState(null); // { kind: 'ok'|'none'|'error', text }
  const noticeTimer = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setScanning(true);
    setScanInfo(null);
    setError(null);
    try {
      const image = await fileToScaledDataUrl(file);
      const data = await api.post('/api/prices/scan', { image });
      setResult(data);
      if (data.identified?.found && data.identified.name) {
        setQ(data.identified.name);
        setScanInfo({ kind: 'ok', text: `Read as “${data.identified.name}”` });
      } else {
        setScanInfo({
          kind: 'none',
          text: 'Couldn’t read a card from that photo. Try a clearer, well-lit shot — or type the name.',
        });
      }
      window.scrollTo({ top: 0 });
    } catch (err) {
      setScanInfo({ kind: 'error', text: err.message });
    } finally {
      setScanning(false);
    }
  };

  const flashNotice = (msg) => {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };

  const search = async (page = 1) => {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/prices/search${qs({ q: query, page, pageSize: PAGE_SIZE })}`);
      setResult(data);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const totalPages = result ? Math.max(1, Math.ceil((result.totalCount || 0) / PAGE_SIZE)) : 1;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Price Lookup</h1>
      </div>

      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          search(1);
        }}
      >
        <input
          type="search"
          className="search-input"
          placeholder="Search a card… e.g. Charizard"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          enterKeyHint="search"
        />
        <button type="submit" className="btn btn-primary btn-lg" disabled={loading || !q.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </button>
        <button
          type="button"
          className="btn btn-lg"
          onClick={() => fileRef.current?.click()}
          disabled={scanning}
          title="Take or upload a photo of the card"
        >
          {scanning ? 'Reading…' : '📷 Scan'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="visually-hidden"
          onChange={onPickPhoto}
        />
      </form>

      {scanInfo && (
        <div
          className={`banner ${
            scanInfo.kind === 'error'
              ? 'banner-error'
              : scanInfo.kind === 'none'
                ? 'banner-info'
                : 'banner-success'
          }`}
        >
          {scanInfo.kind === 'ok' ? '📷 ' : scanInfo.kind === 'error' ? '⚠️ ' : '🤔 '}
          {scanInfo.text}
        </div>
      )}

      {scanning && <Loading label="Reading the card…" />}

      {notice && <div className="banner banner-success">✅ {notice}</div>}

      {error &&
        (error.status === 502 ? (
          <div className="banner banner-error">
            <span className="banner-msg">
              📡 The price service is unavailable right now — the Pokémon TCG API may be down
              or slow. Give it a minute and try again. <span className="muted">({error.message})</span>
            </span>
            <button type="button" className="btn btn-sm" onClick={() => search(result?.page || 1)}>
              Retry
            </button>
          </div>
        ) : (
          <ErrorBanner error={error} onRetry={() => search(1)} />
        ))}

      {loading && <Loading label="Looking up prices…" />}

      {!loading && !error && !result && (
        <EmptyState
          icon="🔎"
          title="Search for any Pokémon card"
          hint={'Type a card name and hit Search. You’ll get market prices and your asking price for every variant — then add copies straight to inventory.'}
        />
      )}

      {!loading && result && result.cards?.length === 0 && (
        <EmptyState
          icon="🤷"
          title={`No cards found for “${q.trim()}”`}
          hint="Check the spelling, or try a shorter part of the name."
        />
      )}

      {!loading && result && result.cards?.length > 0 && (
        <>
          <div className="results-meta">
            {result.totalCount} result{result.totalCount === 1 ? '' : 's'} · your price ={' '}
            {result.sell_percentage}% of market
          </div>
          <div className="price-grid">
            {result.cards.map((card) => {
              const variants = Object.entries(card.prices || {});
              return (
                <div className="price-card" key={card.tcg_card_id}>
                  {card.image_url ? (
                    <img className="price-img" src={card.image_url} alt={card.name} loading="lazy" />
                  ) : (
                    <div className="price-img price-img-placeholder">🎴</div>
                  )}
                  <div className="price-info">
                    <div className="price-name">{card.name}</div>
                    <div className="price-meta">
                      {card.set_name}
                      {card.card_number ? ` · #${card.card_number}` : ''}
                      {card.rarity && <span className="rarity">{card.rarity}</span>}
                    </div>
                    {variants.length === 0 ? (
                      <div className="muted variant-empty">No price data for this printing.</div>
                    ) : (
                      <div className="variant-list">
                        {variants.map(([variant, prices]) => {
                          const suggested = card.suggested?.[variant] ?? null;
                          return (
                            <div className="variant-row" key={variant}>
                              <div className="variant-name">{variantLabel(variant)}</div>
                              <div className="variant-prices">
                                <span className="variant-market">
                                  Mkt <b>{fmtMoney(prices?.market)}</b>
                                </span>
                                <span className="your-price" title="Your asking price">
                                  {fmtMoney(suggested)}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() =>
                                  setAdding({
                                    card,
                                    variant,
                                    market: prices?.market ?? null,
                                    suggested,
                                  })
                                }
                              >
                                + Add
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="pager">
              <button
                type="button"
                className="btn"
                disabled={result.page <= 1}
                onClick={() => search(result.page - 1)}
              >
                ← Prev
              </button>
              <span className="muted">
                Page {result.page} of {totalPages}
              </span>
              <button
                type="button"
                className="btn"
                disabled={result.page >= totalPages}
                onClick={() => search(result.page + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {adding && (
        <AddToInventoryModal
          {...adding}
          onClose={() => setAdding(null)}
          onAdded={(qty) => {
            flashNotice(
              `Added ${qty}× ${adding.card.name} (${variantLabel(adding.variant)}) to inventory`
            );
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}
