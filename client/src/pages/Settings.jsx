import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import Loading from '../components/Loading.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

const FIELDS = [
  {
    key: 'sell_percentage',
    label: 'Sell percentage (%)',
    type: 'number',
    min: 1,
    max: 100,
    step: 1,
    help: 'Your asking price as a percent of market price. 80 means you charge 80% of market — used everywhere a “Your price” is shown.',
  },
  {
    key: 'watch_poll_minutes',
    label: 'Restock check interval (minutes)',
    type: 'number',
    min: 1,
    step: 1,
    help: 'How often the watcher checks each active retail watch. Lower = faster alerts, but be polite to the retailers.',
  },
  {
    key: 'discord_webhook_url',
    label: 'Discord webhook URL',
    type: 'url',
    placeholder: 'https://discord.com/api/webhooks/…',
    help: 'Restock alerts get posted here. In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.',
  },
  {
    key: 'pokemontcg_api_key',
    label: 'Pokémon TCG API key',
    type: 'text',
    placeholder: 'optional',
    help: 'Powers Price Lookup. Works without a key, but a free key from dev.pokemontcg.io raises the rate limit a lot.',
  },
  {
    key: 'bestbuy_api_key',
    label: 'Best Buy API key',
    type: 'text',
    placeholder: 'required for Best Buy watches',
    help: 'Needed only for Best Buy restock checks. Request a free developer key at developer.bestbuy.com, then paste the key here.',
  },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic API key (photo scan)',
    type: 'password',
    placeholder: 'sk-ant-… (optional)',
    help: 'Powers the 📷 Scan button on Price Lookup — snap a photo of a card and it finds the price. Get a key at console.anthropic.com. Leave blank if you only want to type card names.',
  },
];

export default function Settings() {
  const settings = useAsync(() => api.get('/api/settings'), []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, message }
  const savedTimer = useRef(null);

  useEffect(() => {
    if (settings.data && !form) {
      const initial = {};
      for (const f of FIELDS) initial[f.key] = settings.data[f.key] ?? '';
      setForm(initial);
    }
  }, [settings.data, form]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  const save = async (e) => {
    e.preventDefault();
    const pct = Number(form.sell_percentage);
    if (Number.isNaN(pct) || pct < 1 || pct > 100) {
      setSaveError(new Error('Sell percentage must be a number between 1 and 100.'));
      return;
    }
    const poll = Number(form.watch_poll_minutes);
    if (Number.isNaN(poll) || poll < 1) {
      setSaveError(new Error('Restock check interval must be at least 1 minute.'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.put('/api/settings', {
        sell_percentage: pct,
        watch_poll_minutes: poll,
        discord_webhook_url: String(form.discord_webhook_url || '').trim(),
        pokemontcg_api_key: String(form.pokemontcg_api_key || '').trim(),
        bestbuy_api_key: String(form.bestbuy_api_key || '').trim(),
        anthropic_api_key: String(form.anthropic_api_key || '').trim(),
      });
      const next = {};
      for (const f of FIELDS) next[f.key] = updated[f.key] ?? '';
      setForm(next);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const testDiscord = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await api.post('/api/settings/test-discord');
      setTestResult({ ok: true, message: 'Test message sent — check your Discord channel!' });
    } catch (err) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      {settings.loading && !form ? (
        <Loading label="Loading settings…" />
      ) : settings.error && !form ? (
        <ErrorBanner error={settings.error} onRetry={settings.reload} />
      ) : (
        form && (
          <form className="panel" onSubmit={save}>
            <ErrorBanner error={saveError} />
            {saved && <div className="banner banner-success">✅ Settings saved.</div>}

            {FIELDS.map((field) => (
              <label className="field field-stack" key={field.key}>
                <span>{field.label}</span>
                <input
                  type={field.type}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  placeholder={field.placeholder}
                  value={form[field.key]}
                  onChange={set(field.key)}
                />
                <span className="field-hint">{field.help}</span>
                {field.key === 'discord_webhook_url' && (
                  <span className="test-row">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={testDiscord}
                      disabled={testing}
                    >
                      {testing ? 'Sending…' : '📨 Send test message'}
                    </button>
                    {testResult ? (
                      <span className={testResult.ok ? 'pos' : 'neg'}>
                        {testResult.ok ? '✅ ' : '❌ '}
                        {testResult.message}
                      </span>
                    ) : (
                      <span className="field-hint">Uses the saved URL — save first.</span>
                    )}
                  </span>
                )}
              </label>
            ))}

            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
        )
      )}
    </div>
  );
}
