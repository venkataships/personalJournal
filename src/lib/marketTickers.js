// Tickers shown in the live market bar (Watchlist and Sector Pulse pages).
export const MARKET_TICKERS = [
  { symbol: 'SPY',  label: 'S&P 500' },
  { symbol: 'QQQ',  label: 'NASDAQ'  },
  { symbol: 'IWM',  label: 'R2000'   }, // small caps — confirms breadth
  // 10Y slot shows the real yield (^TNX, saved by the bot in each pulse snapshot).
  // IEF (7-10Y Treasury ETF) is still fetched: the sentiment rule uses it for "bonds bid",
  // and the chip falls back to it if no yield is available.
  { symbol: 'IEF',  label: '10Y',  kind: 'yield' },
  { symbol: 'GLD',  label: 'Gold'    },
  { symbol: 'USO',  label: 'Oil'     },
  { symbol: 'IBIT', label: 'Bitcoin' }, // BlackRock Bitcoin ETF
];
