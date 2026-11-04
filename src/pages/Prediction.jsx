import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Brain, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';

const COINS = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'DOGE', 'TRX', 'ADA', 'AVAX', 'LINK'];
const formatMoney = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 6 : 2,
}).format(value);

const Prediction = () => {
  const [coin, setCoin] = useState('BTC');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadPrediction = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/predict', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin, horizons: ['30min', '12h', '24h'] }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Prediction request failed');
      setResult(data);
    } catch (requestError) {
      setResult(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return <div className="pt-32 pb-20 px-8 max-w-7xl mx-auto font-body">
    <div className="text-center space-y-6 mb-12">
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-bold tracking-wider uppercase">
        <Brain size={18} /> Live cached model inference
      </div>
      <h1 className="font-headline text-5xl md:text-6xl font-extrabold text-[#556069] tracking-tight">
        Inspect the <span className="text-[#705953] italic">model output</span>
      </h1>
      <p className="text-lg text-[#605d6a] max-w-2xl mx-auto">All three horizon models run on cached live one-minute market data.</p>
    </div>

    <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
      <select value={coin} onChange={(event) => setCoin(event.target.value)} className="bg-white border border-[#556069]/20 rounded-xl px-5 py-3 text-[#556069] font-bold">
        {COINS.map((symbol) => <option key={symbol}>{symbol}</option>)}
      </select>
      <button onClick={loadPrediction} disabled={loading} className="inline-flex items-center gap-2 bg-[#556069] text-white px-6 py-3 rounded-xl font-bold disabled:opacity-60">
        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> {loading ? 'Loading cached models…' : 'Run prediction'}
      </button>
    </div>
    {error && <div className="max-w-2xl mx-auto mb-8 p-5 rounded-2xl bg-red-50 text-red-700 border border-red-200">{error}</div>}
    {result && <>
      <div className="flex gap-3 items-start max-w-4xl mx-auto mb-8 p-5 rounded-2xl bg-amber-50 text-amber-900 border border-amber-200">
        <AlertTriangle className="shrink-0 mt-0.5" size={20} />
        <div><p className="font-bold">Research output—not financial advice</p><p className="text-sm">{result.warning}</p></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {result.predictions.map((item) => {
          const bullish = item.direction === 'Bullish';
          const Icon = bullish ? TrendingUp : TrendingDown;
          return <motion.article key={item.horizon} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-white/60 backdrop-blur-md rounded-[2rem] p-7 border border-[#556069]/10 shadow-xl shadow-[#556069]/5">
            <div className="flex items-center justify-between mb-6"><span className="text-xs uppercase tracking-widest font-bold text-[#605d6a]/70">{item.horizon}</span><Icon size={24} className={bullish ? 'text-emerald-600' : 'text-rose-600'} /></div>
            <p className={`text-2xl font-extrabold ${bullish ? 'text-emerald-600' : 'text-rose-600'}`}>{item.direction}</p>
            <p className="text-4xl font-headline font-extrabold text-[#556069] my-3">{item.predicted_return_pct >= 0 ? '+' : ''}{item.predicted_return_pct.toFixed(3)}%</p>
            <dl className="space-y-2 text-sm text-[#605d6a]">
              <div className="flex justify-between"><dt>Live price</dt><dd className="font-bold">{formatMoney(item.current_price)}</dd></div>
              <div className="flex justify-between"><dt>Model target</dt><dd className="font-bold">{formatMoney(item.price_target)}</dd></div>
              <div className="flex justify-between"><dt>Test sign accuracy</dt><dd className="font-bold">{(item.evaluation.test_sign_accuracy * 100).toFixed(1)}%</dd></div>
              <div className="flex justify-between"><dt>Response cache</dt><dd className="font-bold">{item.cache_status}</dd></div>
            </dl>
            <p className="text-[11px] text-[#605d6a]/60 mt-5">Market data as of {new Date(item.as_of).toLocaleString()}</p>
          </motion.article>;
        })}
      </div>
    </>}
  </div>;
};

export default Prediction;
