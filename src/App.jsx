import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Chooser from './features/chooser/Chooser';
import Today from './features/today/Today';
import LifeHome from './features/life-home/LifeHome';
import Journal from './features/journal/Journal';
import LifeJournal from './features/life-journal/LifeJournal';
import Positions from './features/positions/Positions';
import Watchlist from './features/watchlist/Watchlist';
import Intelligence from './features/intelligence/Intelligence';
import SectorPulse from './features/sectors/SectorPulse';
import TradingLayout from './components/TradingNav';
import Lookup from './features/lookup/Lookup';
import NotesHistory from './features/notes/NotesHistory';
import Playbook from './features/playbook/Playbook';
import Guide from './features/guide/Guide';
import SystemTrader from './features/system/SystemTrader';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"               element={<Chooser />} />
        <Route path="/life"           element={<LifeHome />} />
        <Route path="/life-journal"   element={<LifeJournal />} />
        <Route path="/trade-journal"  element={<Navigate to="/journal" replace />} />
        {/* Trading pages share one navigation bar */}
        <Route element={<TradingLayout />}>
          <Route path="/trading"        element={<Today />} />
          {/* Home + Dashboard + Tomorrow's Prep were merged into Today (Oct 17) */}
          <Route path="/dashboard"      element={<Navigate to="/trading" replace />} />
          <Route path="/tomorrow-prep"  element={<Navigate to="/trading#prep" replace />} />
          <Route path="/journal"        element={<Journal />} />
          <Route path="/positions"      element={<Positions />} />
          <Route path="/watchlist"      element={<Watchlist />} />
          <Route path="/intelligence"   element={<Intelligence />} />
          <Route path="/sectors"        element={<SectorPulse />} />
          <Route path="/lookup"         element={<Lookup />} />
          <Route path="/lookup/:symbol" element={<Lookup />} />
          <Route path="/notes"          element={<NotesHistory />} />
          <Route path="/notes/:day"     element={<NotesHistory />} />
          <Route path="/playbook"       element={<Playbook />} />
          <Route path="/guide"          element={<Guide />} />
          <Route path="/system"         element={<SystemTrader />} />
        </Route>
        <Route path="*"               element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
