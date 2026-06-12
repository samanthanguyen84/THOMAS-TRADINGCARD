import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import { AlertsContext } from './alertsContext.js';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PriceLookup from './pages/PriceLookup.jsx';
import Inventory from './pages/Inventory.jsx';
import Sales from './pages/Sales.jsx';
import Shows from './pages/Shows.jsx';
import ShowDetail from './pages/ShowDetail.jsx';
import RestockWatch from './pages/RestockWatch.jsx';
import Settings from './pages/Settings.jsx';

const ALERT_POLL_MS = 30_000;

export default function App() {
  // Unseen-alert count for the nav badge — polled every ~30s, refreshable
  // on demand by pages that mutate alerts.
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/api/alerts?unseen=1');
      setCount((data?.alerts || []).length);
    } catch {
      // Badge is best-effort; don't surface polling errors.
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, ALERT_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <AlertsContext.Provider value={{ count, refresh }}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/prices" element={<PriceLookup />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/money" element={<Sales />} />
            <Route path="/shows" element={<Shows />} />
            <Route path="/shows/:id" element={<ShowDetail />} />
            <Route path="/watch" element={<RestockWatch />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AlertsContext.Provider>
  );
}
