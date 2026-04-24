import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DailyDashboard from './features/dashboard/DailyDashboard';
import TomorrowPrep from './features/tomorrow-prep/TomorrowPrep';
import TradingIdentity from './features/identity/TradingIdentity';

export default function App() {
  return (
    <BrowserRouter>
      {/* Splash sits above routed content. Mounts on every full page load. */}
      <TradingIdentity />
      <Routes>
        <Route path="/" element={<DailyDashboard netWorth={560899} />} />
        <Route path="/tomorrow-prep" element={<TomorrowPrep />} />
      </Routes>
    </BrowserRouter>
  );
}
