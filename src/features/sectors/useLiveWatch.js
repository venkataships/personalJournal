import { useEffect, useState } from 'react';
import { supabase, authReady } from '../../lib/supabase';

// The bot's 60-second level watcher (watcher.py) rewrites one row, live_watch id=1, every minute in regular
// hours. The Action board and the focus cards both read it, so they always agree with the alerts.
export default function useLiveWatch(everyMs = 20000) {
  const [st, setSt] = useState({ board: null, ageMin: null, missing: false, loaded: false });
  useEffect(() => {
    let off = false;
    const load = async () => {
      try {
        await authReady();
        const { data, error } = await supabase.from('live_watch').select('as_of, board').eq('id', 1).maybeSingle();
        if (error) throw error;
        if (off) return;
        const ageMin = data?.as_of ? (Date.now() - new Date(data.as_of).getTime()) / 60000 : null;
        setSt({ board: data?.board || null, ageMin, missing: false, loaded: true });
      } catch {
        if (!off) setSt((s) => ({ ...s, missing: true, loaded: true }));
      }
    };
    const first = setTimeout(load, 0);
    const id = setInterval(load, everyMs);
    return () => { off = true; clearTimeout(first); clearInterval(id); };
  }, [everyMs]);
  return st;
}
