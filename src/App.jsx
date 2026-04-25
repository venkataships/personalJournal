import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomeScreen from './features/home/HomeScreen';
import DailyDashboard from './features/dashboard/DailyDashboard';
import TomorrowPrep from './features/tomorrow-prep/TomorrowPrep';
import TradingIdentity from './features/identity/TradingIdentity';
import TradeJournalEntry from './features/trade-journal/TradeJournalEntry';
import LifeJournal from './features/life-journal/LifeJournal';

export default function App() {
  return (
    <BrowserRouter>
      <TradingIdentity />
      <Routes>
        <Route path="/"               element={<HomeScreen />} />
        <Route path="/dashboard"      element={<DailyDashboard />} />
        <Route path="/tomorrow-prep"  element={<TomorrowPrep />} />
        <Route path="/trade-journal"  element={<TradeJournalEntry />} />
        <Route path="/life-journal"   element={<LifeJournal />} />
        <Route path="*"               element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
