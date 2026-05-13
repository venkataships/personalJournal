import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Chooser from './features/chooser/Chooser';
import TradingHome from './features/trading-home/TradingHome';
import LifeHome from './features/life-home/LifeHome';
import DailyDashboard from './features/dashboard/DailyDashboard';
import TomorrowPrep from './features/tomorrow-prep/TomorrowPrep';
import TradeJournalEntry from './features/trade-journal/TradeJournalEntry';
import LifeJournal from './features/life-journal/LifeJournal';
import Positions from './features/positions/Positions';
import Watchlist from './features/watchlist/Watchlist';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"               element={<Chooser />} />
        <Route path="/trading"        element={<TradingHome />} />
        <Route path="/life"           element={<LifeHome />} />
        <Route path="/dashboard"      element={<DailyDashboard />} />
        <Route path="/tomorrow-prep"  element={<TomorrowPrep />} />
        <Route path="/trade-journal"  element={<TradeJournalEntry />} />
        <Route path="/life-journal"   element={<LifeJournal />} />
        <Route path="/positions"      element={<Positions />} />
        <Route path="/watchlist"      element={<Watchlist />} />
        <Route path="*"               element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
