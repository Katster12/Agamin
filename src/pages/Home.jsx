import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, TrendingUp, BarChart3, PieChart, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { CryptoState } from '../CryptoContext';

const CG_API_KEY = 'CG-XgRkwptpUH4LFa6Mub8chHXH';

const formatPrice = (price) => {
  if (!price) return '—';
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
};

const formatLargeNum = (num) => {
  if (!num) return '—';
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  return `$${num.toLocaleString()}`;
};

// Inline scrolling ticker using CSS animation
const TickerBand = ({ coins }) => {
  if (!coins.length) return null;
  const items = [...coins, ...coins]; // duplicate for seamless loop
  return (
    <div className="w-full overflow-hidden bg-white/30 backdrop-blur-sm border-b border-[#556069]/10 py-2.5">
      <div className="ticker-track flex whitespace-nowrap" style={{ animation: 'tickerScroll 60s linear infinite' }}>
        {items.map((coin, idx) => {
          const change = coin.price_change_percentage_24h;
          const isUp = change >= 0;
          return (
            <span key={idx} className="inline-flex items-center gap-2 mx-8 text-sm font-medium text-[#705953]">
              <img src={coin.image} alt={coin.symbol} className="w-4 h-4 rounded-full" />
              <span className="font-bold text-[#556069] uppercase tracking-wide">{coin.symbol}</span>
              <span className="text-[#556069]">{formatPrice(coin.current_price)}</span>
              <span className={isUp ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
                {isUp ? '+' : ''}{change?.toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

const Home = () => {
  const [globalData, setGlobalData] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const { coins } = CryptoState();
  const tickerCoins = coins;
  const topGainer = useMemo(() => [...coins].sort(
    (a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0)
  )[0], [coins]);

  const fetchHomeData = useCallback(async () => {
    try {
      const globalRes = await fetch(`https://api.coingecko.com/api/v3/global`, {
        headers: { 'x-cg-demo-api-key': CG_API_KEY },
      });

      if (globalRes.ok) {
        const g = await globalRes.json();
        setGlobalData(g.data);
      }
    } catch (error) {
      console.error("Failed to load global market data:", error);
    }
  }, []);

  useEffect(() => {
    fetchHomeData();
    const interval = setInterval(fetchHomeData, 30000); // refresh every 30s on home
    return () => clearInterval(interval);
  }, [fetchHomeData]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) navigate(`/market?search=${encodeURIComponent(searchQuery.trim())}`);
  };

  const marketCap = globalData
    ? formatLargeNum(globalData.total_market_cap?.usd)
    : '—';
  const volume = globalData
    ? formatLargeNum(globalData.total_volume?.usd)
    : '—';
  const btcDom = globalData
    ? `${globalData.market_cap_percentage?.btc?.toFixed(1)}%`
    : '—';
  const mcChange = globalData?.market_cap_change_percentage_24h_usd;

  return (
    <div className="pt-20">
      {/* Live Ticker */}
      <TickerBand coins={tickerCoins} />

      {/* Ticker CSS */}
      <style>{`
        @keyframes tickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track { will-change: transform; }
      `}</style>

      {/* Hero */}
      <main className="relative mesh-gradient min-h-[80vh] flex flex-col items-center justify-center px-6 py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center max-w-4xl mx-auto space-y-8"
        >
          <h1 className="font-headline text-5xl md:text-7xl font-extrabold tracking-tighter text-[#556069] leading-tight">
            Track Every Coin. <br />
            <span className="text-[#705953] italic">Trade with Confidence.</span>
          </h1>
          <p className="font-body text-xl md:text-2xl text-[#605d6a] max-w-2xl mx-auto leading-relaxed">
            Real-time crypto data from AWS, market signals, and portfolio tools for the digital era.
          </p>

          {/* Search */}
          <form onSubmit={handleSearch} className="relative w-full max-w-2xl mx-auto mt-12">
            <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
              <Search className="text-[#556069]/40" size={22} />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for a crypto (e.g. BTC, ETH, SOL)..."
              className="w-full bg-white/70 backdrop-blur-md border-2 border-[#556069]/5 h-16 pl-16 pr-32 rounded-2xl text-lg text-[#556069] placeholder:text-[#556069]/30 transition-all duration-300 focus:outline-none focus:border-[#556069]/20 shadow-xl shadow-[#556069]/5"
            />
            <button
              type="submit"
              className="absolute right-3 top-3 bottom-3 bg-[#556069] text-white px-6 rounded-xl font-bold text-sm hover:bg-[#3e4851] transition-colors"
            >
              Search
            </button>
          </form>
        </motion.div>

        {/* Live Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl mx-auto mt-24 px-4">
          <StatCard
            title="Total Market Cap"
            value={marketCap}
            change={mcChange != null ? `${mcChange >= 0 ? '+' : ''}${mcChange.toFixed(2)}%` : '+2.4%'}
            icon={<TrendingUp />}
            color={mcChange >= 0 ? 'emerald' : 'rose'}
          />
          <StatCard title="24h Trading Volume" value={volume} change="" icon={<BarChart3 />} color="primary" />
          <StatCard title="BTC Dominance" value={btcDom} change="" icon={<PieChart />} color="emerald" />
        </div>
      </main>

      {/* Market Pulse */}
      <section className="max-w-7xl mx-auto px-8 py-24">
        <div className="flex justify-between items-end mb-12">
          <div>
            <h2 className="font-headline text-3xl font-bold text-[#556069]">Market Pulse</h2>
            <p className="text-[#705953] mt-2">Live market updates from the realtime AWS pipeline.</p>
          </div>
          <Link to="/market" className="flex items-center gap-2 text-[#556069] font-bold hover:gap-4 transition-all">
            View all markets <ArrowRight size={20} />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Top coins mini list */}
          <motion.div
            whileHover={{ y: -4 }}
            className="md:col-span-8 bg-white/40 backdrop-blur-sm border border-[#556069]/5 rounded-3xl p-8 shadow-lg shadow-[#556069]/5"
          >
            <h3 className="font-headline text-xl font-bold text-[#556069] mb-6">Top Coins by Market Cap</h3>
            <div className="space-y-4">
              {(tickerCoins.slice(0, 5)).map((coin, i) => {
                const ch = coin.price_change_percentage_24h;
                const isUp = ch >= 0;
                return (
                  <div key={coin.id} className="flex items-center gap-4 group hover:bg-white/50 p-3 rounded-2xl transition-colors cursor-pointer">
                    <span className="text-xs font-bold text-[#705953] w-4">{i + 1}</span>
                    <img src={coin.image} alt={coin.symbol} className="w-8 h-8 rounded-full" />
                    <div className="flex-1">
                      <p className="font-bold text-[#556069] text-sm">{coin.name}</p>
                      <p className="text-xs text-[#705953]/60 font-medium uppercase">{coin.symbol}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-[#556069] text-sm">{formatPrice(coin.current_price)}</p>
                      <p className={`text-xs font-bold flex items-center justify-end gap-0.5 ${isUp ? 'text-emerald-600' : 'text-rose-500'}`}>
                        <ArrowUpRight size={11} className={isUp ? '' : 'rotate-180'} />
                        {Math.abs(ch ?? 0).toFixed(2)}%
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <Link to="/market" className="mt-6 block text-center text-sm font-bold text-[#556069]/60 hover:text-[#556069] transition-colors">
              See all 16 coins →
            </Link>
          </motion.div>

          {/* Top Gainer */}
          <motion.div
            whileHover={{ y: -4 }}
            className="md:col-span-4 bg-[#e6c8bf] rounded-3xl p-10 flex flex-col justify-between shadow-lg shadow-[#705953]/10"
          >
            <div>
              <span className="inline-block px-3 py-1 bg-white/20 text-[#705953] text-xs font-bold rounded-full mb-4 uppercase tracking-wider">
                🔥 Top Gainer (24h)
              </span>
              {topGainer && (
                <div className="flex items-center gap-3 mt-2">
                  <img src={topGainer.image} alt={topGainer.symbol} className="w-10 h-10 rounded-full" />
                  <h3 className="font-headline text-xl font-bold text-[#705953]">{topGainer.name}</h3>
                </div>
              )}
            </div>
            {topGainer && (
              <div className="mt-8 space-y-2">
                <span className="text-4xl font-extrabold text-[#705953]">
                  +{topGainer.price_change_percentage_24h?.toFixed(2)}%
                </span>
                <p className="text-[#705953]/70">Movement in last 24h</p>
                <p className="text-[#705953] font-bold">{formatPrice(topGainer.current_price)}</p>
              </div>
            )}
            <Link
              to="/market"
              className="mt-8 block text-center bg-white/40 text-[#705953] py-3 rounded-2xl font-bold hover:bg-white transition-colors"
            >
              View Market →
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  );
};

const StatCard = ({ title, value, change, icon, color = 'emerald' }) => (
  <motion.div
    whileHover={{ y: -5 }}
    className="bg-white/40 backdrop-blur-sm border border-[#556069]/5 p-8 rounded-3xl relative overflow-hidden group shadow-lg shadow-[#556069]/5"
  >
    <div className="relative z-10 flex flex-col justify-between h-full space-y-4">
      <span className="text-sm font-semibold uppercase tracking-widest text-[#705953]">{title}</span>
      <div className="flex items-end justify-between">
        <span className="text-3xl font-bold text-[#556069] font-headline tracking-tight">{value}</span>
        {change && (
          <span className={`text-sm font-bold ${color === 'emerald' ? 'text-emerald-600' : color === 'rose' ? 'text-rose-500' : 'text-[#556069]'}`}>
            {change}
          </span>
        )}
      </div>
    </div>
    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity text-[#556069]">
      {icon}
    </div>
  </motion.div>
);

export default Home;
