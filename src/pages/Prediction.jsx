import { motion } from 'framer-motion';
import { Brain, TrendingUp, ShieldCheck, Zap } from 'lucide-react';

const Prediction = () => {
  const loadPrediction = async (coin) => {
  try {

    const response = await fetch("/api/predict", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ coin })
    });

    const data = await response.json();

    console.log("Prediction API Response:", data);

  } catch (error) {
    console.error(error);
  }
};
  return (
    <div className="pt-32 pb-20 px-8 max-w-7xl mx-auto font-body">
      <div className="text-center space-y-6 mb-20">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-bold tracking-wider uppercase"
        >
          <Brain size={18} /> AI-Powered Predictions
        </motion.div>
        <h1 className="font-headline text-5xl md:text-6xl font-extrabold text-[#556069] tracking-tight">
          Anticipate the <span className="text-[#705953] italic">Market Pulse</span>
        </h1>
        <p className="text-lg text-[#605d6a] max-w-2xl mx-auto leading-relaxed">
          Our advanced algorithms analyze millions of data points to provide you with the most accurate market forecasts in the industry.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-12">
          <motion.div 
            whileHover={{ scale: 1.01 }}
            className="bg-white/40 backdrop-blur-md rounded-[2.5rem] p-10 border border-[#556069]/5 shadow-2xl shadow-[#556069]/5"
          >
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold text-[#556069]">Market Sentiment Analysis</h2>
              <span className="text-emerald-600 font-bold bg-emerald-50 px-4 py-1 rounded-full">Bullish</span>
            </div>
            <div className="aspect-[21/9] bg-[#c5d0db]/20 rounded-2xl mb-8 flex items-center justify-center">
               <TrendingUp size={48} className="text-[#556069]/20" />
            </div>
            <p className="text-[#605d6a] leading-relaxed">
              Current market dynamics indicate a strong consolidation phase for Bitcoin and major altcoins. Our model predicts a significant breakout in the next 72 hours, driven by increased institutional adoption and positive macro-economic indicators.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             <FeatureCard 
               icon={<ShieldCheck size={24} />} 
               title="Risk Management" 
               desc="Quantify your downside exposure with our proprietary risk scoring system."
             />
             <FeatureCard 
               icon={<Zap size={24} />} 
               title="Real-time Alerts" 
               desc="Never miss a market shift with instant notifications on volatility changes."
             />
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-[#e2dded] rounded-[2.5rem] p-8 shadow-xl shadow-[#605d6a]/10">
            <h3 className="text-xl font-bold text-[#605d6a] mb-6 font-headline">Top Predictions</h3>
            <ul className="space-y-6">
              <PredictionItem coin="BTC" target="$68,500" prob="82%" />
              <PredictionItem coin="ETH" target="$3,800" prob="75%" />
              <PredictionItem coin="SOL" target="$165" prob="68%" />
              <PredictionItem coin="ADA" target="$0.52" prob="61%" />
            </ul>
          </div>

          <div className="bg-[#705953] rounded-[2.5rem] p-8 text-white relative overflow-hidden">
            <button
  onClick={() => loadPrediction("BTC")}
  className="bg-[#556069] text-white px-6 py-3 rounded-xl"
>
  Test Prediction API
</button>
            <div className="relative z-10">
              <h3 className="text-xl font-bold mb-4 font-headline text-white/90">Premium Insights</h3>
              <p className="text-white/70 text-sm leading-relaxed mb-6">
                Unlock deep-dive reports and institutional-grade analytics with Agamin Pro.
              </p>
              <button className="w-full bg-white text-[#705953] py-4 rounded-2xl font-bold hover:scale-105 transition-transform">
                Upgrade Now
              </button>
            </div>
            <div className="absolute -bottom-10 -right-10 opacity-10 rotate-12">
               <Brain size={120} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const FeatureCard = ({ icon, title, desc }) => (
  <div className="bg-white/40 backdrop-blur-md p-8 rounded-[2rem] border border-[#556069]/5 shadow-lg shadow-[#556069]/5 group hover:border-[#556069]/20 transition-all">
    <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary mb-6 group-hover:scale-110 transition-transform">
      {icon}
    </div>
    <h4 className="font-bold text-[#556069] mb-2">{title}</h4>
    <p className="text-sm text-[#605d6a] leading-relaxed">{desc}</p>
  </div>
);

const PredictionItem = ({ coin, target, prob }) => (
  <li className="flex items-center justify-between group">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 bg-white/50 rounded-full flex items-center justify-center font-bold text-xs text-[#605d6a]">
        {coin}
      </div>
      <div>
        <p className="text-sm font-bold text-[#605d6a]">Target: {target}</p>
        <p className="text-[10px] uppercase tracking-wider text-[#605d6a]/60 font-bold">Confidence</p>
      </div>
    </div>
    <span className="text-emerald-600 font-bold text-lg">{prob}</span>
  </li>
);

export default Prediction;
