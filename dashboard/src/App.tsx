import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import OpportunitiesPage from './pages/OpportunitiesPage';
import TradeHistoryPage from './pages/TradeHistoryPage';
import PositionsPage from './pages/PositionsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/opportunities" element={<OpportunitiesPage />} />
          <Route path="/trades" element={<TradeHistoryPage />} />
          <Route path="/positions" element={<PositionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}