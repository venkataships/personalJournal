import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DailyDashboard from './features/dashboard/DailyDashboard';
import TomorrowPrep from './features/tomorrow-prep/TomorrowPrep';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DailyDashboard netWorth={560899} />} />
        <Route path="/tomorrow-prep" element={<TomorrowPrep />} />
      </Routes>
    </BrowserRouter>
  );
}
