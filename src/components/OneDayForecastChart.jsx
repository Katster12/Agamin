import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { compute1DForecastData } from '../services/forecastUtils';

const fmtNum = (n, dec = 2) => {
  if (n == null || isNaN(n)) return '—';
  const absN = Math.abs(n);
  if (absN >= 1000) {
    return absN.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  if (absN >= 1) return absN.toFixed(dec);
  if (absN >= 0.01) return absN.toFixed(4);
  return absN.toFixed(6);
};

export const OneDayForecastChart = ({ chartData, prediction }) => {
  const svgRef = useRef(null);
  const [hoverState, setHoverState] = useState(null);

  const prices = chartData?.prices;
  if (!prices || prices.length < 2) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Activity size={48} className="text-[#556069]/10" />
      </div>
    );
  }

  const forecast = compute1DForecastData(prices, prediction);
  if (!forecast) return null;

  const {
    currentPrice,
    avgPrice,
    maxPrice,
    minPrice,
    avgChangePct,
    maxChangePct,
    minChangePct,
  } = forecast;

  const vals = prices.map((p) => p[1]);

  // Chart Canvas Dimensions
  const W = 920;
  const H = 340;
  const START_X = 55;
  const SPLIT_X = 520;
  const END_X = 705;
  const START_Y = 30;
  const END_Y = 255;

  // Determine global min and max with breathing space
  const allPrices = [...vals, maxPrice, minPrice, avgPrice, currentPrice];
  const dataMin = Math.min(...allPrices);
  const dataMax = Math.max(...allPrices);
  const pad = (dataMax - dataMin) * 0.1 || 1;
  const yMin = dataMin - pad;
  const yMax = dataMax + pad;
  const yRange = yMax - yMin;

  const getPastX = (i) => START_X + (i / (vals.length - 1)) * (SPLIT_X - START_X);
  const getY = (v) => START_Y + (1 - (v - yMin) / yRange) * (END_Y - START_Y);

  // Key Y levels
  const currentY = getY(currentPrice);
  const maxY = getY(maxPrice);
  const avgY = getY(avgPrice);
  const minY = getY(minPrice);

  // Historical Past 24H Path
  const coords = vals.map((v, i) => `${getPastX(i).toFixed(1)},${getY(v).toFixed(1)}`);
  const pastLine = `M ${coords.join(' L ')}`;
  const pastArea = `${pastLine} L ${SPLIT_X.toFixed(1)},${END_Y} L ${START_X},${END_Y} Z`;

  // Upper Cone (between Current horizontal level and Max line)
  const upperCone = `M ${SPLIT_X.toFixed(1)},${currentY.toFixed(1)} L ${END_X.toFixed(1)},${maxY.toFixed(1)} L ${END_X.toFixed(1)},${currentY.toFixed(1)} Z`;

  // Lower Cone (between Current horizontal level and Min line)
  const lowerCone = `M ${SPLIT_X.toFixed(1)},${currentY.toFixed(1)} L ${END_X.toFixed(1)},${currentY.toFixed(1)} L ${END_X.toFixed(1)},${minY.toFixed(1)} Z`;

  // Horizontal Y-axis ticks (4 levels)
  const yTicks = [];
  for (let i = 0; i <= 3; i++) {
    yTicks.push(dataMin + ((dataMax - dataMin) * i) / 3);
  }

  // Calculate non-overlapping positions for right badges
  const badgeH = 22;
  const badgeGap = 5;
  const badgeList = [
    { id: 'max', targetY: maxY, originalY: maxY, label: 'Max', pct: maxChangePct, price: maxPrice, bg: '#0d9488' },
    { id: 'avg', targetY: avgY, originalY: avgY, label: 'Avg', pct: avgChangePct, price: avgPrice, bg: '#059669' },
    { id: 'current', targetY: currentY, originalY: currentY, label: 'Current', pct: 0, price: currentPrice, bg: '#2563eb' },
    { id: 'min', targetY: minY, originalY: minY, label: 'Min', pct: minChangePct, price: minPrice, bg: '#e11d48' },
  ].sort((a, b) => a.targetY - b.targetY);

  // Adjust overlapping badges downwards
  for (let i = 1; i < badgeList.length; i++) {
    if (badgeList[i].targetY < badgeList[i - 1].targetY + badgeH + badgeGap) {
      badgeList[i].targetY = badgeList[i - 1].targetY + badgeH + badgeGap;
    }
  }
  // Check bounds at bottom
  if (badgeList[badgeList.length - 1].targetY > END_Y + 10) {
    const shift = badgeList[badgeList.length - 1].targetY - (END_Y + 10);
    badgeList.forEach((b) => { b.targetY -= shift; });
  }

  // Time labels for Past
  const pastTimes = [
    { x: START_X, label: '-24h' },
    { x: START_X + (SPLIT_X - START_X) * 0.33, label: '-16h' },
    { x: START_X + (SPLIT_X - START_X) * 0.66, label: '-8h' },
    { x: SPLIT_X, label: 'Now' },
  ];

  // Time labels for Forecast
  const forecastTimes = [
    { x: SPLIT_X + (END_X - SPLIT_X) * 0.33, label: '+8h' },
    { x: SPLIT_X + (END_X - SPLIT_X) * 0.66, label: '+16h' },
    { x: END_X, label: '+24h' },
  ];

  // Mouse interaction handler
  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    if (clientX == null) return;
    const relX = clientX - rect.left;
    const svgX = (relX / rect.width) * W;

    if (svgX < START_X || svgX > END_X) {
      setHoverState(null);
      return;
    }

    if (svgX <= SPLIT_X) {
      // In Past section
      const pastRatio = (svgX - START_X) / (SPLIT_X - START_X);
      const idx = Math.min(vals.length - 1, Math.max(0, Math.round(pastRatio * (vals.length - 1))));
      setHoverState({
        mode: 'past',
        x: getPastX(idx),
        y: getY(vals[idx]),
        time: prices[idx][0],
        price: vals[idx],
      });
    } else {
      // In Forecast section
      const forecastRatio = (svgX - SPLIT_X) / (END_X - SPLIT_X);
      const hours = Math.round(forecastRatio * 24);
      const estPrice = currentPrice + (avgPrice - currentPrice) * forecastRatio;
      const estMax = currentPrice + (maxPrice - currentPrice) * forecastRatio;
      const estMin = currentPrice + (minPrice - currentPrice) * forecastRatio;
      setHoverState({
        mode: 'forecast',
        x: svgX,
        y: getY(estPrice),
        hours,
        estPrice,
        estMax,
        estMin,
      });
    }
  };

  return (
    <div
      className="relative w-full h-full cursor-crosshair group px-1 py-1"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverState(null)}
      onTouchMove={handleMouseMove}
      onTouchEnd={() => setHoverState(null)}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          {/* Subtle gradient for past price area */}
          <linearGradient id="past-grad-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.20} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0.01} />
          </linearGradient>

          {/* Mint-teal gradient for upper bullish forecast cone */}
          <linearGradient id="mint-cone-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.22} />
          </linearGradient>

          {/* Soft pink gradient for lower bearish forecast cone */}
          <linearGradient id="pink-cone-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.20} />
          </linearGradient>
        </defs>

        {/* ── HORIZONTAL GRID LINES & RIGHT-ALIGNED Y-AXIS LABELS ── */}
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
                opacity={0.10}
              />
              <text
                x={W - 10}
                y={y + 3.5}
                fill="#64748b"
                fontSize="10px"
                fontWeight="600"
                textAnchor="end"
                className="font-headline select-none pointer-events-none tabular-nums opacity-75"
              >
                {fmtNum(val)}
              </text>
            </g>
          );
        })}

        {/* ── VERTICAL DELIMITER LINE AT TRANSITION (NOW) ── */}
        <line
          x1={SPLIT_X}
          y1={START_Y - 5}
          x2={SPLIT_X}
          y2={END_Y + 10}
          stroke="#556069"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.15}
        />

        {/* ── 1D FORECAST SHADED CONES ── */}
        {/* Upper Mint-Teal Cone */}
        <path d={upperCone} fill="url(#mint-cone-grad)" />

        {/* Lower Pink Cone */}
        <path d={lowerCone} fill="url(#pink-cone-grad)" />

        {/* ── PAST 24H LINE & GRADIENT FILL ── */}
        <path d={pastArea} fill="url(#past-grad-area)" />
        <motion.path
          d={pastLine}
          fill="none"
          stroke="#2563eb"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.65, ease: 'easeOut' }}
        />

        {/* ── FORECAST RADIATING LINES ── */}
        {/* Max Estimate Dotted Line */}
        <line
          x1={SPLIT_X}
          y1={currentY}
          x2={END_X}
          y2={maxY}
          stroke="#10b981"
          strokeWidth={1.75}
          strokeDasharray="3 3"
        />

        {/* Avg Estimate Dashed Line */}
        <line
          x1={SPLIT_X}
          y1={currentY}
          x2={END_X}
          y2={avgY}
          stroke="#10b981"
          strokeWidth={2}
          strokeDasharray="5 4"
        />

        {/* Current Baseline Level Line */}
        <line
          x1={SPLIT_X}
          y1={currentY}
          x2={END_X}
          y2={currentY}
          stroke="#2563eb"
          strokeWidth={1.5}
        />

        {/* Min Estimate Dotted Line */}
        <line
          x1={SPLIT_X}
          y1={currentY}
          x2={END_X}
          y2={minY}
          stroke="#f43f5e"
          strokeWidth={1.75}
          strokeDasharray="3 3"
        />

        {/* ── CURRENT POINT CIRCULAR NODE ── */}
        <circle
          cx={SPLIT_X}
          cy={currentY}
          r={5.5}
          fill="#2563eb"
          stroke="#ffffff"
          strokeWidth={2.5}
        />

        {/* ── RIGHT PRICE BADGES (Max, Avg, Current, Min) ── */}
        {badgeList.map((badge) => {
          const badgeWidth = 142;
          const badgeHeight = 22;
          const badgeX = END_X + 2;
          const badgeY = badge.targetY - badgeHeight / 2;
          const isShifted = Math.abs(badge.targetY - badge.originalY) > 2;

          return (
            <g key={badge.id}>
              {/* Optional connector line if badge position was shifted to avoid overlap */}
              {isShifted && (
                <line
                  x1={END_X}
                  y1={badge.originalY}
                  x2={badgeX}
                  y2={badge.targetY}
                  stroke={badge.bg}
                  strokeWidth={1}
                  opacity={0.5}
                />
              )}

              {/* Badge Background Rectangle */}
              <rect
                x={badgeX}
                y={badgeY}
                width={badgeWidth}
                height={badgeHeight}
                rx={3}
                fill={badge.bg}
                className="shadow-sm"
              />

              {/* Vertical Divider Line inside Badge */}
              <line
                x1={badgeX + 76}
                y1={badgeY}
                x2={badgeX + 76}
                y2={badgeY + badgeHeight}
                stroke="rgba(255, 255, 255, 0.28)"
                strokeWidth={1}
              />

              {/* Left Column Label & Percentage */}
              <text
                x={badgeX + 38}
                y={badgeY + 14.5}
                fill="#ffffff"
                fontSize="9.5px"
                fontWeight="700"
                textAnchor="middle"
                className="select-none pointer-events-none tabular-nums"
              >
                {badge.id === 'current'
                  ? 'Current'
                  : `${badge.label} ${badge.pct >= 0 ? '+' : ''}${badge.pct.toFixed(2)}%`}
              </text>

              {/* Right Column Formatted Price */}
              <text
                x={badgeX + 109}
                y={badgeY + 14.5}
                fill="#ffffff"
                fontSize="10px"
                fontWeight="700"
                textAnchor="middle"
                className="select-none pointer-events-none tabular-nums"
              >
                {fmtNum(badge.price)}
              </text>
            </g>
          );
        })}

        {/* ── TIME AXIS LABELS ── */}
        {/* Past Timeline Ticks */}
        {pastTimes.map((pt, i) => (
          <text
            key={`pt-${i}`}
            x={pt.x}
            y={END_Y + 48}
            fill="#64748b"
            fontSize="10px"
            fontWeight="700"
            textAnchor={i === 0 ? 'start' : i === pastTimes.length - 1 ? 'middle' : 'middle'}
            className="select-none pointer-events-none opacity-80"
          >
            {pt.label}
          </text>
        ))}

        {/* Forecast Timeline Ticks */}
        {forecastTimes.map((ft, i) => (
          <text
            key={`ft-${i}`}
            x={ft.x}
            y={END_Y + 48}
            fill="#64748b"
            fontSize="10px"
            fontWeight="700"
            textAnchor="middle"
            className="select-none pointer-events-none opacity-80"
          >
            {ft.label}
          </text>
        ))}

        {/* ── BOTTOM PILL BUTTONS (PAST 24H & 1D FORECAST) ── */}
        {/* PAST 24H Pill Badge */}
        <g>
          <rect
            x={(START_X + SPLIT_X) / 2 - 42}
            y={END_Y + 12}
            width={84}
            height={20}
            rx={6}
            fill="#f1f5f9"
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          <text
            x={(START_X + SPLIT_X) / 2}
            y={END_Y + 25.5}
            fill="#64748b"
            fontSize="9px"
            fontWeight="800"
            letterSpacing="0.8px"
            textAnchor="middle"
            className="select-none uppercase pointer-events-none"
          >
            PAST 24H
          </text>
        </g>

        {/* 1D FORECAST Pill Badge */}
        <g>
          <rect
            x={(SPLIT_X + END_X) / 2 - 50}
            y={END_Y + 12}
            width={100}
            height={20}
            rx={6}
            fill="#f1f5f9"
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          <text
            x={(SPLIT_X + END_X) / 2}
            y={END_Y + 25.5}
            fill="#64748b"
            fontSize="9px"
            fontWeight="800"
            letterSpacing="0.8px"
            textAnchor="middle"
            className="select-none uppercase pointer-events-none"
          >
            1D FORECAST
          </text>
        </g>

        {/* ── HOVER TRACKER CROSSHAIR ── */}
        {hoverState && (
          <g>
            <line
              x1={hoverState.x}
              y1={START_Y}
              x2={hoverState.x}
              y2={END_Y}
              stroke="#2563eb"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              opacity={0.7}
            />
            <circle
              cx={hoverState.x}
              cy={hoverState.y}
              r={5}
              fill="#2563eb"
              stroke="#fff"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {/* ── INTERACTIVE HOVER TOOLTIP ── */}
      {hoverState && (
        <div
          className="absolute pointer-events-none bg-white/95 backdrop-blur-md rounded-xl shadow-xl border border-[#556069]/15 p-3.5 z-30 font-body transition-all duration-100 ease-out"
          style={{
            left: `${((hoverState.x - 10) / W) * 100}%`,
            top: '12px',
            transform: `translateX(${hoverState.x > W * 0.7 ? '-105%' : hoverState.x < W * 0.3 ? '5%' : '-50%'})`,
            minWidth: '190px',
          }}
        >
          {hoverState.mode === 'past' ? (
            <>
              <div className="text-[10px] font-bold text-[#705953] uppercase tracking-wider mb-1.5 border-b border-[#556069]/10 pb-1">
                {new Date(hoverState.time).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </div>
              <div className="flex justify-between items-center gap-3">
                <span className="text-xs font-bold text-[#64748b]">Price:</span>
                <span className="text-sm font-extrabold text-[#0f172a] tabular-nums">
                  ${fmtNum(hoverState.price)}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="text-[10px] font-bold text-[#10b981] uppercase tracking-wider mb-1.5 border-b border-[#556069]/10 pb-1 flex justify-between">
                <span>Forecast Projection</span>
                <span>+{hoverState.hours}h</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between items-center gap-3">
                  <span className="text-gray-500 font-semibold">Target (Avg):</span>
                  <span className="font-bold text-[#059669] tabular-nums">
                    ${fmtNum(hoverState.estPrice)}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-3">
                  <span className="text-gray-500 font-semibold">High Estimate:</span>
                  <span className="font-bold text-[#0d9488] tabular-nums">
                    ${fmtNum(hoverState.estMax)}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-3">
                  <span className="text-gray-500 font-semibold">Low Estimate:</span>
                  <span className="font-bold text-[#e11d48] tabular-nums">
                    ${fmtNum(hoverState.estMin)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default OneDayForecastChart;

