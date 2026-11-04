import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Globe, MessageSquare, RefreshCw, TrendingUp, TrendingDown, Activity, ExternalLink } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { getCoinPrediction } from "../services/predictionService";
import OneDayForecastChart, { compute1DForecastData } from "../components/OneDayForecastChart";

const CG_API_KEY = 'CG-XgRkwptpUH4LFa6Mub8chHXH';

// ── UTILITIES ────────────────────────────────────────────────────────────────
const fmt = (n, dec = 2) => {
  if (n == null) return '—';
  const isNeg = n < 0;
  const absN = Math.abs(n);
  const sign = isNeg ? '-' : '';
  if (absN >= 1e12) return `${sign}$${(absN / 1e12).toFixed(dec)}T`;
  if (absN >= 1e9) return `${sign}$${(absN / 1e9).toFixed(dec)}B`;
  if (absN >= 1e6) return `${sign}$${(absN / 1e6).toFixed(dec)}M`;
  if (absN >= 1000) return `${sign}$${absN.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (absN >= 1) return `${sign}$${absN.toFixed(2)}`;
  return `${sign}$${absN.toFixed(6)}`;
};

const fmtNum = (n) => {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

const computeCVD = (data) => {
  if (!data?.prices || !data?.total_volumes) return data;
  let cumulative = 0;
  const cvd = [];
  for (let i = 0; i < data.prices.length; i++) {
    const time = data.prices[i][0];
    const price = data.prices[i][1];
    const vol = data.total_volumes[i] ? data.total_volumes[i][1] : 0;
    if (i > 0) {
      const prevPrice = data.prices[i-1][1];
      if (price >= prevPrice) cumulative += vol;
      else cumulative -= vol;
    }
    cvd.push([time, cumulative]);
  }
  return { ...data, cvd };
};

// ── SUBCOMPONENTS ────────────────────────────────────────────────────────────

const CoinHeader = ({ coin, md, price, change24h, isUp }) => (
  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 border-b border-[#556069]/10 pb-10">
    <div className="flex items-center gap-5">
      <div className="w-20 h-20 rounded-[1.5rem] bg-white/60 border border-[#556069]/10 shadow-lg flex items-center justify-center p-3">
        {coin?.image?.large && (
          <img src={coin.image.large} alt={coin.name} className="w-full h-full object-contain" />
        )}
      </div>
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-4xl md:text-5xl font-extrabold text-[#556069] font-headline">{coin?.name}</h1>
          <span className="bg-[#556069]/10 text-[#556069] text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest">
            #{md?.market_cap_rank}
          </span>
        </div>
        <p className="text-lg font-bold text-[#705953] uppercase tracking-widest">{coin?.symbol}</p>
      </div>
    </div>

    <div className="text-left sm:text-right">
      <p className="text-4xl md:text-5xl font-bold text-[#556069] font-headline tabular-nums">
        {fmt(price)}
      </p>
      <div className={`flex items-center gap-1 mt-2 sm:justify-end font-bold text-lg ${isUp ? 'text-emerald-600' : 'text-rose-500'}`}>
        {isUp ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
        {isUp ? '+' : ''}{change24h?.toFixed(2)}% (24h)
      </div>
    </div>
  </div>
);

const PriceCard = ({
  chartData,
  chartLoading,
  chartDays,
  setChartDays,
  isUp,
  chartSource,
  chartMetric,
  setChartMetric,
  coin,
  prediction,
}) => {
  const prices = chartData?.[chartMetric] || [];

  const formatValue = (v) => {
    return fmt(v, chartMetric === 'prices' ? 2 : 2);
  };

  const isOneDayPriceForecast = chartDays === 1 && chartMetric === 'prices';
  const forecastDetails = isOneDayPriceForecast
    ? compute1DForecastData(chartData?.prices, coin, prediction)
    : null;

  return (
    <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-[#556069]/5 overflow-hidden shadow-lg">
      {/* ── TOP CONTROL BAR (IDENTICAL FOR ALL TIMEFRAMES) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 border-b border-[#556069]/5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-bold text-[#556069] font-headline">
            {chartMetric === 'prices' ? 'Price Chart' : chartMetric === 'market_caps' ? 'Market Cap Chart' : 'CVD (Cumulative Volume Delta)'}
          </h3>
          <div className="flex bg-[#556069]/5 p-1 rounded-xl border border-[#556069]/5">
            {[
              { label: 'Price', val: 'prices' },
              { label: 'Market Cap', val: 'market_caps' },
              { label: 'CVD', val: 'cvd' }
            ].map(({ label, val }) => (
              <button
                key={val}
                onClick={() => setChartMetric(val)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all duration-250 cursor-pointer ${
                  chartMetric === val
                    ? 'bg-[#556069] text-white shadow-sm'
                    : 'text-[#556069]/60 hover:text-[#556069]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {[
            { label: '1D', val: 1 },
            { label: '7D', val: 7 },
            { label: '30D', val: 30 },
            { label: '1Y', val: 365 },
          ].map(({ label, val }) => (
            <button
              key={val}
              onClick={() => setChartDays(val)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                chartDays === val
                  ? 'bg-[#556069] text-white shadow-sm'
                  : 'bg-[#556069]/5 text-[#556069] hover:bg-[#556069]/10'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── CHART CANVAS (ALWAYS FIXED 320px FOR PERFECT UI STABILITY) ── */}
      <div className="relative" style={{ height: 320 }}>
        {chartLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <RefreshCw size={24} className="text-[#556069]/30 animate-spin" />
          </div>
        ) : (
          <div style={{ width: '100%', height: '100%' }}>
            <CoinChart
              chartData={chartData}
              isPositive={isUp}
              chartDays={chartDays}
              chartMetric={chartMetric}
              coin={coin}
              prediction={prediction}
            />
          </div>
        )}
      </div>

      {prices.length > 1 && !chartLoading && (
        <div className="flex justify-between px-6 py-3 border-t border-[#556069]/5 text-xs text-[#556069]/50 font-medium tabular-nums">
          <span>Low: {formatValue(Math.min(...prices.map(p => p[1])))}</span>
          <span>Source: {isOneDayPriceForecast ? 'CoinGecko + 1D Consensus Forecast' : chartSource === 'athena' ? 'S3 + Athena' : 'CoinGecko fallback'}</span>
          <span>High: {formatValue(Math.max(...prices.map(p => p[1])))}</span>
        </div>
      )}
    </div>
  );
};

// Helper to format axis labels based on time range
const formatXAxisLabel = (timestamp, days) => {
  const date = new Date(timestamp);
  if (days <= 1) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } else if (days <= 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else if (days <= 30) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
};

const formatYAxisLabel = (value) => {
  if (value == null) return '—';
  const isNeg = value < 0;
  const absVal = Math.abs(value);
  const sign = isNeg ? '-' : '';
  if (absVal >= 1e12) return `${sign}$${(absVal / 1e12).toFixed(2)}T`;
  if (absVal >= 1e9) return `${sign}$${(absVal / 1e9).toFixed(2)}B`;
  if (absVal >= 1e6) return `${sign}$${(absVal / 1e6).toFixed(2)}M`;
  if (absVal >= 1000) return `${sign}$${(absVal / 1000).toFixed(1)}K`;
  if (absVal >= 1) return `${sign}$${absVal.toFixed(2)}`;
  return `${sign}$${absVal.toFixed(4)}`;
};

const formatPriceBadge = (value) => {
  if (value == null || isNaN(value)) return '—';
  const absVal = Math.abs(value);
  if (absVal >= 1000) {
    return absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (absVal >= 1) return absVal.toFixed(2);
  if (absVal >= 0.01) return absVal.toFixed(4);
  return absVal.toFixed(6);
};

const CoinChart = ({ chartData, isPositive, chartDays = 7, chartMetric = 'prices', coin, prediction }) => {
  const svgRef = useRef(null);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [forecastHover, setForecastHover] = useState(null);

  const prices = chartData?.[chartMetric];
  const volumes = chartData?.total_volumes;

  if (!prices || prices.length < 2) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Activity size={48} className="text-[#556069]/10" />
      </div>
    );
  }

  // Exact 7D geometry and dimensions
  const W = 800;
  const H = 260;
  const START_X = 85; 
  const END_X = W - 30; // 770
  const START_Y = 25;
  const END_Y = H - 45; // 215

  const isForecast1D = chartDays === 1 && chartMetric === 'prices';
  const forecast = isForecast1D ? compute1DForecastData(prices, coin, prediction) : null;

  const vals = prices.map((p) => p[1]);
  const currentPrice = vals[vals.length - 1];

  // 1D forecast horizontal layout within the EXACT same dimensions
  const SPLIT_X = 490; // Historical line covers 85 to 490 (~60%)
  const FORECAST_END_X = 645; // Radiating lines reach 645
  const BADGE_X = 650; // Badges from 650 to 768
  const BADGE_W = 118; // Fits neatly before END_X (770)

  // Price range calculation
  let minV, maxV;
  if (isForecast1D && forecast) {
    const allVals = [...vals, forecast.maxPrice, forecast.minPrice, forecast.avgPrice, currentPrice];
    const rawMin = Math.min(...allVals);
    const rawMax = Math.max(...allVals);
    const pad = (rawMax - rawMin) * 0.08 || 1;
    minV = rawMin - pad;
    maxV = rawMax + pad;
  } else {
    minV = Math.min(...vals);
    maxV = Math.max(...vals);
  }
  const range = maxV - minV || 1;

  const getX = (i) => {
    if (isForecast1D) {
      return START_X + (i / (vals.length - 1)) * (SPLIT_X - START_X);
    }
    return START_X + (i / (vals.length - 1)) * (END_X - START_X);
  };

  const getY = (v) => START_Y + (1 - (v - minV) / range) * (END_Y - START_Y);

  const coords = vals.map((v, i) => `${getX(i).toFixed(2)},${getY(v).toFixed(2)}`);
  const line = `M ${coords.join(' L ')}`;
  const lastX = isForecast1D ? SPLIT_X : getX(vals.length - 1);
  const area = `${line} L ${lastX.toFixed(2)},${END_Y} L ${getX(0).toFixed(2)},${END_Y} Z`;

  const color = isPositive ? '#10b981' : '#f43f5e';
  const uid = `chart-${isPositive ? 'u' : 'd'}`;

  // Horizontal Y-grid ticks (4 levels - IDENTICAL TO 7D)
  const yTicks = [];
  for (let i = 0; i <= 3; i++) {
    yTicks.push(minV + (range * i) / 3);
  }

  // Vertical X-grid ticks
  const xTickIndices = [];
  if (vals.length >= 4) {
    xTickIndices.push(0);
    xTickIndices.push(Math.floor((vals.length - 1) * 0.33));
    xTickIndices.push(Math.floor((vals.length - 1) * 0.66));
    xTickIndices.push(vals.length - 1);
  } else {
    vals.forEach((_, i) => xTickIndices.push(i));
  }

  // Forecast Y positions & wedges (1D only)
  const currentY = getY(currentPrice);
  const maxY = forecast ? getY(forecast.maxPrice) : currentY;
  const avgY = forecast ? getY(forecast.avgPrice) : currentY;
  const minY = forecast ? getY(forecast.minPrice) : currentY;

  const upperWedge = isForecast1D
    ? `M ${SPLIT_X.toFixed(1)},${currentY.toFixed(1)} L ${FORECAST_END_X.toFixed(1)},${maxY.toFixed(1)} L ${FORECAST_END_X.toFixed(1)},${currentY.toFixed(1)} Z`
    : '';

  const lowerWedge = isForecast1D
    ? `M ${SPLIT_X.toFixed(1)},${currentY.toFixed(1)} L ${FORECAST_END_X.toFixed(1)},${currentY.toFixed(1)} L ${FORECAST_END_X.toFixed(1)},${minY.toFixed(1)} Z`
    : '';

  // Badges position with collision avoidance
  const badgeH = 18;
  const badgeGap = 4;
  let badges = [];
  if (isForecast1D && forecast) {
    badges = [
      { id: 'max', targetY: maxY, label: 'Max', pct: forecast.maxChangePct, price: forecast.maxPrice, bg: '#0d9488' },
      { id: 'avg', targetY: avgY, label: 'Avg', pct: forecast.avgChangePct, price: forecast.avgPrice, bg: '#059669' },
      { id: 'cur', targetY: currentY, label: 'Current', pct: 0, price: currentPrice, bg: '#2563eb' },
      { id: 'min', targetY: minY, label: 'Min', pct: forecast.minChangePct, price: forecast.minPrice, bg: '#e11d48' },
    ].sort((a, b) => a.targetY - b.targetY);

    for (let i = 1; i < badges.length; i++) {
      if (badges[i].targetY < badges[i - 1].targetY + badgeH + badgeGap) {
        badges[i].targetY = badges[i - 1].targetY + badgeH + badgeGap;
      }
    }
    if (badges[badges.length - 1].targetY > END_Y) {
      const shift = badges[badges.length - 1].targetY - END_Y;
      badges.forEach((b) => { b.targetY -= shift; });
    }
  }

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    if (clientX == null) return;
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const svgX = pct * W;

    if (isForecast1D && svgX > SPLIT_X && svgX <= FORECAST_END_X) {
      // Hovering in forecast zone
      setHoverIdx(null);
      const forecastRatio = (svgX - SPLIT_X) / (FORECAST_END_X - SPLIT_X);
      const hours = Math.round(forecastRatio * 24);
      const estPrice = currentPrice + (forecast.avgPrice - currentPrice) * forecastRatio;
      setForecastHover({ svgX, hours, estPrice });
    } else {
      setForecastHover(null);
      const pastEndX = isForecast1D ? SPLIT_X : END_X;
      const effectivePct = Math.max(0, Math.min(1, (svgX - START_X) / (pastEndX - START_X)));
      const idx = Math.round(effectivePct * (prices.length - 1));
      setHoverIdx(idx);
    }
  };

  const handleMouseLeave = () => {
    setHoverIdx(null);
    setForecastHover(null);
  };

  const hoveredTime = hoverIdx !== null && prices[hoverIdx] ? prices[hoverIdx][0] : null;
  const hoveredPrice = hoverIdx !== null && prices[hoverIdx] ? prices[hoverIdx][1] : null;
  const hoveredVol = hoverIdx !== null && volumes && volumes[hoverIdx] ? volumes[hoverIdx][1] : null;
  
  const dateParts = hoveredTime ? new Date(hoveredTime).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : '';

  return (
    <div 
      className="relative w-full h-full cursor-crosshair group px-2 py-4"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchMove={(e) => handleMouseMove(e.touches[0])}
      onTouchEnd={handleMouseLeave}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.01} />
          </linearGradient>

          {/* Forecast cone gradients */}
          <linearGradient id="cone-green" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.06} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.18} />
          </linearGradient>
          <linearGradient id="cone-pink" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.06} />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.18} />
          </linearGradient>
        </defs>

        {/* ── BACKGROUND GRID LINES & AXIS LABELS (IDENTICAL TO 7D) ── */}
        
        {/* Horizontal Y-Gridlines & Labels */}
        {yTicks.map((val, idx) => {
          const y = getY(val);
          return (
            <g key={`y-grid-${idx}`}>
              <line
                x1={START_X}
                y1={y}
                x2={END_X}
                y2={y}
                stroke="#556069"
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.12}
              />
              <text
                x={START_X - 12}
                y={y + 3.5}
                fill="#556069"
                fontSize="10px"
                fontWeight="700"
                textAnchor="end"
                className="font-headline select-none pointer-events-none opacity-60 tabular-nums"
              >
                {formatYAxisLabel(val)}
              </text>
            </g>
          );
        })}

        {/* 1D FORECAST CONES & LINES (ONLY VISIBLE ON 1D) */}
        {isForecast1D && forecast && (
          <g>
            {/* Shaded Cones */}
            <path d={upperWedge} fill="url(#cone-green)" />
            <path d={lowerWedge} fill="url(#cone-pink)" />

            {/* Delimiter vertical line at Now */}
            <line
              x1={SPLIT_X}
              y1={START_Y}
              x2={SPLIT_X}
              y2={END_Y}
              stroke="#556069"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.18}
            />

            {/* Radiating lines */}
            <line x1={SPLIT_X} y1={currentY} x2={FORECAST_END_X} y2={maxY} stroke="#10b981" strokeWidth={1.5} strokeDasharray="3 3" />
            <line x1={SPLIT_X} y1={currentY} x2={FORECAST_END_X} y2={avgY} stroke="#10b981" strokeWidth={2} strokeDasharray="5 4" />
            <line x1={SPLIT_X} y1={currentY} x2={FORECAST_END_X} y2={currentY} stroke="#2563eb" strokeWidth={1.2} opacity={0.65} />
            <line x1={SPLIT_X} y1={currentY} x2={FORECAST_END_X} y2={minY} stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="3 3" />

            {/* Current node circle */}
            <circle cx={SPLIT_X} cy={currentY} r={4.5} fill={color} stroke="#ffffff" strokeWidth={2} />

            {/* 4 Price Badges on the right */}
            {badges.map((b) => {
              const bY = b.targetY - badgeH / 2;
              return (
                <g key={b.id}>
                  <rect x={BADGE_X} y={bY} width={BADGE_W} height={badgeH} rx={3} fill={b.bg} />
                  <line x1={BADGE_X + 62} y1={bY} x2={BADGE_X + 62} y2={bY + badgeH} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                  <text x={BADGE_X + 31} y={bY + 12} fill="#ffffff" fontSize="8.5px" fontWeight="700" textAnchor="middle" className="select-none pointer-events-none tabular-nums">
                    {b.id === 'cur' ? 'Current' : `${b.label} ${b.pct >= 0 ? '+' : ''}${b.pct.toFixed(1)}%`}
                  </text>
                  <text x={BADGE_X + 89} y={bY + 12} fill="#ffffff" fontSize="8.5px" fontWeight="700" textAnchor="middle" className="select-none pointer-events-none tabular-nums">
                    {formatPriceBadge(b.price)}
                  </text>
                </g>
              );
            })}

            {/* PAST 24H and 1D FORECAST Sub-Pills */}
            <g>
              <rect x={(START_X + SPLIT_X) / 2 - 32} y={END_Y + 5} width={64} height={14} rx={3} fill="#556069" fillOpacity={0.08} />
              <text x={(START_X + SPLIT_X) / 2} y={END_Y + 15} fill="#556069" fontSize="7.5px" fontWeight="800" textAnchor="middle" letterSpacing="0.5px" className="select-none uppercase pointer-events-none">
                PAST 24H
              </text>

              <rect x={(SPLIT_X + FORECAST_END_X) / 2 - 38} y={END_Y + 5} width={76} height={14} rx={3} fill="#556069" fillOpacity={0.08} />
              <text x={(SPLIT_X + FORECAST_END_X) / 2} y={END_Y + 15} fill="#556069" fontSize="7.5px" fontWeight="800" textAnchor="middle" letterSpacing="0.5px" className="select-none uppercase pointer-events-none">
                1D FORECAST
              </text>
            </g>
          </g>
        )}

        {/* Vertical X-Gridlines, Ticks & Labels */}
        {!isForecast1D ? (
          xTickIndices.map((i) => {
            const x = getX(i);
            const t = prices[i][0];
            return (
              <g key={`x-grid-${i}`}>
                <line
                  x1={x}
                  y1={START_Y}
                  x2={x}
                  y2={END_Y}
                  stroke="#556069"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  opacity={0.08}
                />
                <line
                  x1={x}
                  y1={END_Y}
                  x2={x}
                  y2={END_Y + 5}
                  stroke="#556069"
                  strokeWidth={1.5}
                  opacity={0.4}
                />
                <text
                  x={x}
                  y={END_Y + 20}
                  fill="#556069"
                  fontSize="10px"
                  fontWeight="700"
                  textAnchor="middle"
                  className="font-headline select-none pointer-events-none opacity-60"
                >
                  {formatXAxisLabel(t, chartDays)}
                </text>
              </g>
            );
          })
        ) : (
          // 1D Time Labels matching exact 7D typography & placement
          <g>
            {[
              { x: START_X, label: '-24h' },
              { x: START_X + (SPLIT_X - START_X) * 0.5, label: '-12h' },
              { x: SPLIT_X, label: 'Now' },
              { x: SPLIT_X + (FORECAST_END_X - SPLIT_X) * 0.5, label: '+12h' },
              { x: FORECAST_END_X, label: '+24h' },
            ].map((tick, idx) => (
              <g key={`forecast-tick-${idx}`}>
                <line x1={tick.x} y1={END_Y} x2={tick.x} y2={END_Y + 4} stroke="#556069" strokeWidth={1} opacity={0.3} />
                <text
                  x={tick.x}
                  y={END_Y + 30}
                  fill="#556069"
                  fontSize="9px"
                  fontWeight="700"
                  textAnchor="middle"
                  className="font-headline select-none pointer-events-none opacity-60"
                >
                  {tick.label}
                </text>
              </g>
            ))}
          </g>
        )}

        {/* ── AXES BORDERS (IDENTICAL TO 7D) ── */}
        {/* Y-Axis Line */}
        <line
          x1={START_X}
          y1={START_Y - 10}
          x2={START_X}
          y2={END_Y}
          stroke="#556069"
          strokeWidth={1.5}
          opacity={0.3}
        />
        {/* X-Axis Line */}
        <line
          x1={START_X}
          y1={END_Y}
          x2={END_X + 10}
          y2={END_Y}
          stroke="#556069"
          strokeWidth={1.5}
          opacity={0.3}
        />

        {/* ── AXIS TITLES (IDENTICAL TO 7D) ── */}
        {/* Y-Axis Title */}
        <text
          transform="rotate(-90)"
          x={-(START_Y + END_Y) / 2}
          y={22}
          fill="#705953"
          fontSize="9px"
          fontWeight="800"
          letterSpacing="2px"
          textAnchor="middle"
          className="font-headline select-none uppercase pointer-events-none opacity-80"
        >
          {chartMetric === 'prices' ? 'Value in USD (Price)' : chartMetric === 'market_caps' ? 'Value in USD (Market Cap)' : 'Cumulative Vol (USD)'}
        </text>
        {/* X-Axis Title */}
        <text
          x={(START_X + END_X) / 2}
          y={H - 4}
          fill="#705953"
          fontSize="9px"
          fontWeight="800"
          letterSpacing="2px"
          textAnchor="middle"
          className="font-headline select-none uppercase pointer-events-none opacity-80"
        >
          Timeline ({chartDays} Day{chartDays > 1 ? 's' : ''})
        </text>

        {/* ── CHART PATHS (IDENTICAL STYLING TO 7D) ── */}
        {chartMetric === 'cvd' ? (
          <g>
            {vals.map((v, i) => {
              const x = getX(i);
              const w = Math.max(1, (END_X - START_X) / vals.length - 1);
              const zeroY = Math.max(START_Y, Math.min(END_Y, getY(0)));
              const y = getY(v);
              const h = Math.abs(y - zeroY);
              const top = Math.min(y, zeroY);
              const isBarUp = v >= 0;
              return (
                <rect
                  key={`cvd-bar-${i}`}
                  x={x - w/2}
                  y={top}
                  width={w}
                  height={Math.max(1, h)}
                  fill={isBarUp ? '#10b981' : '#f43f5e'}
                  opacity={hoverIdx === null || hoverIdx === i ? 0.9 : 0.3}
                  className="transition-opacity duration-150"
                />
              );
            })}
          </g>
        ) : (
          <>
            <motion.path
              d={area}
              fill={`url(#${uid})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: chartMetric === 'market_caps' ? 0.7 : 1 }}
              transition={{ duration: 0.4 }}
              key={`area-${chartDays}-${chartMetric}-${prices.length}`}
            />
            {chartMetric !== 'market_caps' && (
              <motion.path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0.5 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.75, ease: "easeOut" }}
                key={`line-${chartDays}-${chartMetric}-${prices.length}`}
              />
            )}
          </>
        )}
        
        {/* ── INTERACTIVE HOVER CROSSHAIR & GLOWING DOT (IDENTICAL TO 7D) ── */}
        {hoverIdx !== null && hoveredPrice !== null && (
          <g>
            {/* Vertical crosshair tracker */}
            <line 
              x1={getX(hoverIdx)} 
              y1={START_Y - 5} 
              x2={getX(hoverIdx)} 
              y2={END_Y} 
              stroke={color} 
              strokeWidth={1.5} 
              strokeDasharray="3 3" 
            />
            {/* Horizontal crosshair tracker */}
            <line 
              x1={START_X} 
              y1={getY(hoveredPrice)} 
              x2={END_X + 5} 
              y2={getY(hoveredPrice)} 
              stroke={color} 
              strokeWidth={1.5} 
              strokeDasharray="3 3" 
              opacity={0.5} 
            />
            {/* Pulsating outer core ring */}
            <circle 
              cx={getX(hoverIdx)} 
              cy={getY(hoveredPrice)} 
              r={9} 
              fill={color} 
              fillOpacity={0.2}
              className="animate-ping"
            />
            {/* Glossy inner core dot */}
            <circle 
              cx={getX(hoverIdx)} 
              cy={getY(hoveredPrice)} 
              r={5} 
              fill={color} 
              stroke="#fff" 
              strokeWidth={2} 
            />
          </g>
        )}

        {/* 1D Forecast Zone Hover Tracker */}
        {forecastHover && (
          <g>
            <line
              x1={forecastHover.svgX}
              y1={START_Y - 5}
              x2={forecastHover.svgX}
              y2={END_Y}
              stroke="#059669"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              opacity={0.7}
            />
            <circle
              cx={forecastHover.svgX}
              cy={getY(forecastHover.estPrice)}
              r={5}
              fill="#059669"
              stroke="#fff"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {/* ── HOVER TOOLTIP OVERLAY (IDENTICAL DESIGN TO 7D) ── */}
      {hoverIdx !== null && hoveredPrice !== null && (
        <div 
          className="absolute pointer-events-none bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-[#556069]/10 p-4 z-20 font-body transition-all duration-150 ease-out"
          style={{
            left: `${((getX(hoverIdx) - 8) / W) * 100}%`,
            top: '12px',
            transform: `translateX(${(hoverIdx / prices.length) > 0.72 ? '-105%' : (hoverIdx / prices.length) < 0.28 ? '5%' : '-50%'})`,
            minWidth: '200px'
          }}
        >
          <div className="text-[10px] font-bold text-[#705953] uppercase tracking-wider mb-2 border-b border-[#556069]/10 pb-1.5 select-none">
            {dateParts}
          </div>
          <div className="flex justify-between items-center gap-4 mb-1.5">
            <span className="text-xs font-bold text-[#705953] uppercase tracking-wider select-none">
              {chartMetric === 'prices' ? 'Price' : chartMetric === 'market_caps' ? 'Market Cap' : 'CVD'}:
            </span>
            <span className="text-sm font-extrabold text-[#556069] tabular-nums">
              {fmt(hoveredPrice, chartMetric === 'prices' ? 4 : 2)}
            </span>
          </div>
          {hoveredVol !== null && (
            <div className="flex justify-between items-center gap-4">
              <span className="text-xs font-bold text-[#705953] uppercase tracking-wider select-none">Vol:</span>
              <span className="text-xs font-bold text-[#556069]/80 tabular-nums">
                {fmt(hoveredVol, 0)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 1D Forecast Tooltip in identical 7D glassmorphic style */}
      {forecastHover && forecast && (
        <div
          className="absolute pointer-events-none bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-[#556069]/10 p-4 z-20 font-body transition-all duration-150 ease-out"
          style={{
            left: `${((forecastHover.svgX - 8) / W) * 100}%`,
            top: '12px',
            transform: 'translateX(-50%)',
            minWidth: '190px'
          }}
        >
          <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-2 border-b border-[#556069]/10 pb-1.5 flex justify-between select-none">
            <span>Forecast Projection</span>
            <span>+${forecastHover.hours}h</span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between items-center gap-4">
              <span className="font-bold text-[#705953]">Target:</span>
              <span className="font-extrabold text-emerald-600 tabular-nums">
                {fmt(forecastHover.estPrice)}
              </span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="font-bold text-[#705953]">Max Potential:</span>
              <span className="font-bold text-[#0d9488] tabular-nums">
                {fmt(forecast.maxPrice)}
              </span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="font-bold text-[#705953]">Min Support:</span>
              <span className="font-bold text-rose-500 tabular-nums">
                {fmt(forecast.minPrice)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


const MarketStats = ({ md, coin }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
    <InfoBlock label="Market Cap" value={fmt(md?.market_cap?.usd)} />
    <InfoBlock label="24h Volume" value={fmt(md?.total_volume?.usd)} />
    <InfoBlock label="Circ. Supply" value={`${fmtNum(md?.circulating_supply)} ${coin?.symbol?.toUpperCase()}`} />
    <InfoBlock label="Max Supply" value={md?.max_supply ? `${fmtNum(md.max_supply)} ${coin?.symbol?.toUpperCase()}` : '∞'} />
    <InfoBlock label="ATH" value={fmt(md?.ath?.usd)} sub={`${md?.ath_change_percentage?.usd?.toFixed(1)}% from ATH`} />
    <InfoBlock label="ATL" value={fmt(md?.atl?.usd)} />
    <InfoBlock label="7d Change" value={`${(md?.price_change_percentage_7d ?? 0) >= 0 ? '+' : ''}${md?.price_change_percentage_7d?.toFixed(2) ?? '—'}%`} color={(md?.price_change_percentage_7d ?? 0) >= 0 ? '#10b981' : '#f43f5e'} />
    <InfoBlock label="30d Change" value={`${(md?.price_change_percentage_30d ?? 0) >= 0 ? '+' : ''}${md?.price_change_percentage_30d?.toFixed(2) ?? '—'}%`} color={(md?.price_change_percentage_30d ?? 0) >= 0 ? '#10b981' : '#f43f5e'} />
  </div>
);

const SentimentSection = ({ md }) => (
  <div className="bg-white/40 backdrop-blur-md rounded-3xl p-7 border border-[#556069]/5 shadow-lg">
    <h3 className="font-bold text-[#556069] text-lg mb-5 font-headline">Price Changes</h3>
    <div className="space-y-4">
      {[
        { label: '1h', val: md?.price_change_percentage_1h_in_currency?.usd },
        { label: '24h', val: md?.price_change_percentage_24h },
        { label: '7d', val: md?.price_change_percentage_7d },
        { label: '30d', val: md?.price_change_percentage_30d },
        { label: '1y', val: md?.price_change_percentage_1y },
      ].map(({ label, val }) => {
        const up = (val ?? 0) >= 0;
        const pct = Math.min(Math.abs(val ?? 0), 100);
        return (
          <div key={label} className="flex items-center gap-3">
            <span className="text-xs font-bold text-[#705953] w-6 uppercase">{label}</span>
            <div className="flex-1 h-2 bg-[#556069]/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background: up ? '#10b981' : '#f43f5e',
                }}
              />
            </div>
            <span className={`text-xs font-bold w-16 text-right tabular-nums ${up ? 'text-emerald-600' : 'text-rose-500'}`}>
              {up ? '+' : ''}{val?.toFixed(2) ?? '—'}%
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────

const CoinDetail = () => {
  const { id } = useParams();
  const { BACKEND_URL } = useAuth();

  const [coin, setCoin] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [chartSource, setChartSource] = useState(null);
  const [chartDays, setChartDays] = useState(7);
  const [chartMetric, setChartMetric] = useState('prices');
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(true);
  const [prediction, setPrediction] = useState(null);
  const [error, setError] = useState(null);

  const fetchCoin = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/coingecko?path=/coins/${id}&localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      setCoin(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchChart = useCallback(async (days) => {
    setChartLoading(true);
    try {
      const query = new URLSearchParams({ days: String(days) });
      if (coin?.symbol) query.set('symbol', coin.symbol);

      const athenaRes = await fetch(`${BACKEND_URL}/api/coins/${id}/history?${query.toString()}`);
      if (athenaRes.ok) {
        const athenaData = await athenaRes.json();
        if (athenaData?.prices?.length > 1) {
          setChartData(computeCVD(athenaData));
          setChartSource('athena');
          return;
        }
      }

      const res = await fetch(
        `/api/coingecko?path=/coins/${id}/market_chart&vs_currency=usd&days=${days}`
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      setChartData(computeCVD(d));
      setChartSource('coingecko');
    } catch (_) {}
    finally { setChartLoading(false); }
  }, [BACKEND_URL, coin?.symbol, id]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchCoin();
    const intervalId = setInterval(fetchCoin, 30000);
    return () => clearInterval(intervalId);
  }, [fetchCoin, id]);

  useEffect(() => {
    fetchChart(chartDays);
  }, [fetchChart, chartDays, id]);
  useEffect(() => {
  const loadPrediction = async () => {
    try {
      const result = await getCoinPrediction(id);
      setPrediction(result);
    } catch (err) {
      console.error("Prediction error:", err);
    }
  };

  loadPrediction();
}, [id]);

  const md = coin?.market_data;
  const price = md?.current_price?.usd;
  const change24h = md?.price_change_percentage_24h;
  const isUp = (change24h ?? 0) >= 0;

  if (loading) return <LoadingSkeleton />;
  if (error) return (
    <div className="pt-32 pb-20 px-8 max-w-7xl mx-auto text-center">
      <p className="text-rose-500 font-bold text-lg">Failed to load coin data: {error}</p>
      <Link to="/market" className="mt-4 inline-block text-[#556069] font-bold hover:underline">
        ← Back to Market
      </Link>
    </div>
  );

  return (
    <div className="pt-28 pb-20 px-4 md:px-8 max-w-7xl mx-auto font-body">
      <Link to="/market" className="inline-flex items-center gap-2 text-[#556069]/60 hover:text-[#556069] font-bold mb-8 transition-colors group">
        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
        Back to Market
      </Link>

      <div className="flex flex-col lg:flex-row gap-12 items-start mb-12">
        <div className="w-full lg:w-2/3 space-y-8">
          <CoinHeader coin={coin} md={md} price={price} change24h={change24h} isUp={isUp} />
          <PriceCard 
            chartData={chartData} 
            chartLoading={chartLoading} 
            chartDays={chartDays} 
            setChartDays={setChartDays} 
            isUp={isUp} 
            chartSource={chartSource} 
            chartMetric={chartMetric}
            setChartMetric={setChartMetric}
            coin={coin}
            prediction={prediction}
          />
          <MarketStats md={md} coin={coin} />
        </div>

        <div className="w-full lg:w-1/3 space-y-6">
          {coin?.description?.en && (
            <div className="bg-white/40 backdrop-blur-md rounded-3xl p-7 border border-[#556069]/5 shadow-lg">
              <h3 className="font-bold text-[#556069] text-lg mb-4 font-headline">About {coin.name}</h3>
              <p className="text-sm text-[#605d6a] leading-relaxed line-clamp-6"
                dangerouslySetInnerHTML={{ __html: coin.description.en.split('. ').slice(0, 4).join('. ') + '.' }}
              />
            </div>
          )}

          <SentimentSection md={md} />
          <div className="bg-white/40 backdrop-blur-md rounded-3xl p-7 border border-[#556069]/5 shadow-lg">
  <h3 className="font-bold text-[#556069] text-lg mb-5 font-headline">
    AI Price Prediction
  </h3>

  {prediction ? (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold text-[#705953] uppercase tracking-wider">
          Current Price
        </p>

        <p className="text-2xl font-bold text-[#556069]">
          ${prediction.currentPrice}
        </p>
      </div>

      <div>
        <p className="text-xs font-bold text-[#705953] uppercase tracking-wider">
          Predicted Price
        </p>

        <p className="text-3xl font-extrabold text-emerald-600">
          ${prediction.predictedPrice}
        </p>
      </div>

      <div className="flex justify-between">
        <div>
          <p className="text-xs font-bold text-[#705953] uppercase tracking-wider">
            Signal
          </p>

          <p className="font-bold text-[#556069]">
            {prediction.signal}
          </p>
        </div>

        <div>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-[#705953] uppercase tracking-wider">
          Expected Change
        </p>

        <p className={`font-bold ${
          prediction.change >= 0
            ? "text-emerald-600"
            : "text-rose-500"
        }`}>
          {prediction.change}%
        </p>
      </div>
    </div>
  ) : (
    <p className="text-[#605d6a]">
      Analyzing market trend...
    </p>
  )}
</div>

          {/* Links */}
          <div className="bg-[#e2dded] rounded-3xl p-7 shadow-lg">
            <h3 className="font-bold text-[#605d6a] text-lg mb-5 font-headline flex items-center gap-2">
              <Globe size={18} /> Official Links
            </h3>
            <div className="space-y-3">
              {coin?.links?.homepage?.[0] && (
                <LinkItem label="Website" href={coin.links.homepage[0]} />
              )}
              {coin?.links?.whitepaper && (
                <LinkItem label="Whitepaper" href={coin.links.whitepaper} />
              )}
              {coin?.links?.subreddit_url && (
                <LinkItem label="Reddit" href={coin.links.subreddit_url} icon={<MessageSquare size={14} />} />
              )}
              {coin?.links?.repos_url?.github?.[0] && (
                <LinkItem label="GitHub" href={coin.links.repos_url.github[0]} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── MINOR UI HELPERS ─────────────────────────────────────────────────────────

const InfoBlock = ({ label, value, sub, color }) => (
  <motion.div
    whileHover={{ y: -3 }}
    className="bg-white/40 backdrop-blur-md p-5 rounded-2xl border border-[#556069]/5 shadow-sm"
  >
    <p className="text-[10px] font-bold text-[#705953] uppercase tracking-widest mb-1.5">{label}</p>
    <p className="font-bold text-[#556069] tabular-nums text-sm" style={color ? { color } : {}}>
      {value}
    </p>
    {sub && <p className="text-[10px] text-[#556069]/40 mt-1 font-medium">{sub}</p>}
  </motion.div>
);

const LinkItem = ({ label, href, icon }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center justify-between p-3.5 bg-white/50 rounded-2xl hover:bg-white transition-colors group"
  >
    <div className="flex items-center gap-2 text-sm font-bold text-[#605d6a]">
      {icon || <Globe size={14} />}
      {label}
    </div>
    <ExternalLink size={14} className="text-[#605d6a]/30 group-hover:text-[#556069] transition-colors" />
  </a>
);

const LoadingSkeleton = () => (
  <div className="pt-28 pb-20 px-4 md:px-8 max-w-7xl mx-auto space-y-8 animate-pulse">
    <div className="h-6 w-32 bg-[#556069]/10 rounded" />
    <div className="h-16 w-64 bg-[#556069]/10 rounded-2xl" />
    <div className="h-64 w-full bg-[#556069]/5 rounded-3xl" />
    <div className="grid grid-cols-4 gap-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-20 bg-[#556069]/5 rounded-2xl" />
      ))}
    </div>
  </div>
);

export default CoinDetail;
