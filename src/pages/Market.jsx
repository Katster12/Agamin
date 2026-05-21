import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, ArrowUpRight, ArrowDownRight, RefreshCw, WifiOff, Search, Loader2, LayoutGrid, List, CircleDot, User, X, Sliders, TrendingUp, Sparkles, Activity, RotateCcw, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { CryptoState } from '../CryptoContext';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';


const formatPrice = (price) => {
  if (price === null || price === undefined) return '—';
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
};

const formatLargeNum = (num) => {
  if (!num) return '—';
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  return `$${num.toLocaleString()}`;
};

// ── Pure SVG sparkline ───────────────────────────────────────────────────────
const SparklineChart = ({ prices, isPositive }) => {
  const W = 120;
  const H = 40;
  const PAD = 3;
  const color = isPositive ? '#10b981' : '#f43f5e';
  const bg = isPositive ? 'rgba(236,253,245,0.7)' : 'rgba(255,241,242,0.7)';

  if (!prices || prices.length < 2) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <rect width={W} height={H} rx={8} fill={bg} />
        <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2}
          stroke={color} strokeWidth={1.5} strokeDasharray="4 3" strokeOpacity={0.4} />
      </svg>
    );
  }

  const step = Math.max(1, Math.floor(prices.length / 50));
  const pts = prices.filter((_, i) => i % step === 0);

  const minV = Math.min(...pts);
  const maxV = Math.max(...pts);
  const range = maxV - minV || 1;

  const x = (i) => (PAD + (i / (pts.length - 1)) * (W - PAD * 2)).toFixed(2);
  const y = (v) => (PAD + (1 - (v - minV) / range) * (H - PAD * 2)).toFixed(2);

  const coords = pts.map((v, i) => `${x(i)},${y(v)}`);
  const line = `M ${coords.join(' L ')}`;
  const area = `${line} L ${x(pts.length - 1)},${H} L ${x(0)},${H} Z`;
  const uid = `sg${isPositive ? 'u' : 'd'}${(Math.random() * 1e6 | 0)}`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0.0} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} rx={8} fill={bg} />
      <path d={area} fill={`url(#${uid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])}
        r={3} fill={color} stroke="white" strokeWidth={1.5}
      />
    </svg>
  );
};

const LiveDot = () => (
  <span className="relative flex h-2.5 w-2.5">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
  </span>
);

const FILTERS = ['All', 'DeFi', 'Layer 1', 'Layer 2', 'Metaverse', 'Meme', 'Stablecoins'];

// ── Custom Treemap Content ───────────────────────────────────────────────────
const CustomTreemapContent = (props) => {
  const { depth, x, y, width, height, name, symbol, price_change, id, image, navigate } = props;
  
  if (depth === 1) { // rendering the leaves
    const change = price_change || 0;
    const isUp = change >= 0;
    const absChange = Math.abs(change);
    
    // Intensity mapping (Darker for smaller moves, brighter for bigger moves)
    let fromColor, toColor;
    if (absChange < 0.2) {
      fromColor = 'from-[#556069]'; 
      toColor = 'to-[#3e4851]';
    } else if (isUp) {
      if (absChange >= 10) { fromColor = 'from-emerald-300'; toColor = 'to-emerald-500'; }
      else if (absChange >= 5) { fromColor = 'from-emerald-400'; toColor = 'to-emerald-600'; }
      else if (absChange >= 2) { fromColor = 'from-emerald-600'; toColor = 'to-emerald-800'; }
      else { fromColor = 'from-emerald-800'; toColor = 'to-emerald-950'; }
    } else {
      if (absChange >= 10) { fromColor = 'from-rose-400'; toColor = 'to-rose-600'; }
      else if (absChange >= 5) { fromColor = 'from-rose-500'; toColor = 'to-rose-700'; }
      else if (absChange >= 2) { fromColor = 'from-rose-700'; toColor = 'to-rose-900'; }
      else { fromColor = 'from-rose-800'; toColor = 'to-rose-950'; }
    }

    // Determine what to show based on available space
    const showImage = width > 40 && height > 45;
    const showText = width > 35 && height > 35;
    const showDetails = width > 60 && height > 55;

    return (
      <g>
        <foreignObject x={x} y={y} width={width} height={height}>
          <div
            onClick={() => navigate(`/coin/${id}`)}
            className={`w-full h-full p-1.5 cursor-pointer transition-all duration-300 hover:brightness-110 hover:scale-[0.98] origin-center`}
            style={{ boxSizing: 'border-box' }}
          >
            <div className={`w-full h-full rounded-2xl bg-gradient-to-br ${fromColor} ${toColor} shadow-inner border border-white/20 flex flex-col items-center justify-center relative overflow-hidden group`}>
              
              {/* Glossy overlay effect */}
              <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent opacity-50 pointer-events-none" />

              {showImage && image && (
                <img 
                  src={image} 
                  alt={symbol} 
                  className={`rounded-full bg-white/20 p-1 backdrop-blur-sm shadow-md transition-transform duration-300 group-hover:scale-110 ${showDetails ? 'w-10 h-10 mb-2' : 'w-7 h-7 mb-1'}`}
                />
              )}
              
              {showText && (
                <div className="text-center z-10">
                  <h4 className={`text-white font-headline font-bold leading-tight drop-shadow-md ${showDetails ? 'text-sm' : 'text-[11px]'}`}>
                    {symbol?.toUpperCase()}
                  </h4>
                  {showDetails && (
                    <p className="text-white/90 text-[10px] font-bold mt-0.5 tracking-wider">
                      {isUp ? '+' : ''}{change.toFixed(2)}%
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </foreignObject>
      </g>
    );
  }
  return null;
};

const CustomTreemapTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isUp = data.price_change >= 0;
    return (
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-[#556069]/10 p-4 z-20 font-body pointer-events-none min-w-[200px]">
        <div className="flex items-center gap-3 mb-3 border-b border-[#556069]/10 pb-2">
          <span className="font-headline text-lg font-bold text-[#556069]">{data.name}</span>
          <span className="text-xs font-bold text-[#705953] uppercase tracking-wider bg-[#556069]/5 px-2 py-0.5 rounded-full">{data.symbol}</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between items-center gap-4">
            <span className="text-xs font-bold text-[#705953] uppercase tracking-wider">Market Cap:</span>
            <span className="text-sm font-extrabold text-[#556069]">{formatLargeNum(data.size)}</span>
          </div>
          <div className="flex justify-between items-center gap-4">
            <span className="text-xs font-bold text-[#705953] uppercase tracking-wider">24h Change:</span>
            <span className={`text-sm font-extrabold ${isUp ? 'text-emerald-600' : 'text-rose-500'}`}>
              {isUp ? '+' : ''}{data.price_change?.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

// ── Interactive Sparkline Component for Drawer ──────────────────────────────
const InteractiveDrawerSparkline = ({ prices, isPositive }) => {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [hoveredPrice, setHoveredPrice] = useState(null);
  const containerRef = useRef(null);

  if (!prices || prices.length < 2) {
    return <div className="text-center py-8 text-xs text-[#705953]/40">No historical data</div>;
  }

  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;

  const W = 320;
  const H = 130;
  const PAD_Y = 15;
  const PAD_X = 10;

  const getX = (i) => PAD_X + (i / (prices.length - 1)) * (W - PAD_X * 2);
  const getY = (v) => PAD_Y + (1 - (v - minP) / range) * (H - PAD_Y * 2);

  const coords = prices.map((v, i) => `${getX(i).toFixed(1)},${getY(v).toFixed(1)}`);
  const linePath = `M ${coords.join(' L ')}`;
  const areaPath = `${linePath} L ${getX(prices.length - 1).toFixed(1)},${H} L ${getX(0).toFixed(1)},${H} Z`;

  const color = isPositive ? '#10b981' : '#f43f5e';
  const gradId = `drawer-sparkline-grad-${Math.random().toString(36).substring(2, 9)}`;

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const index = Math.min(
      prices.length - 1,
      Math.max(0, Math.round(xRatio * (prices.length - 1)))
    );
    setHoveredIdx(index);
    setHoveredPrice(prices[index]);
  };

  const handleMouseLeave = () => {
    setHoveredIdx(null);
    setHoveredPrice(null);
  };

  const currentHoverX = hoveredIdx !== null ? getX(hoveredIdx) : 0;
  const currentHoverY = hoveredIdx !== null ? getY(hoveredPrice) : 0;

  return (
    <div className="relative mt-2" ref={containerRef} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      {/* Tooltip Header */}
      <div className="flex justify-between items-center text-[10px] font-bold text-[#705953]/60 mb-2 uppercase tracking-wide">
        <span>7d Price Trend</span>
        {hoveredPrice !== null ? (
          <span className="text-[#556069] font-extrabold text-xs">
            {formatPrice(hoveredPrice)}
          </span>
        ) : (
          <span>Hover to inspect</span>
        )}
      </div>

      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible select-none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0.0} />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        <line x1={PAD_X} y1={PAD_Y} x2={W - PAD_X} y2={PAD_Y} stroke="rgba(85,96,105,0.05)" strokeDasharray="3 3" />
        <line x1={PAD_X} y1={H - PAD_Y} x2={W - PAD_X} y2={H - PAD_Y} stroke="rgba(85,96,105,0.05)" strokeDasharray="3 3" />

        {/* Path Fill */}
        <path d={areaPath} fill={`url(#${gradId})`} />

        {/* Path Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover elements */}
        {hoveredIdx !== null && (
          <g>
            <line
              x1={currentHoverX}
              y1={0}
              x2={currentHoverX}
              y2={H}
              stroke="#556069"
              strokeOpacity={0.2}
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle
              cx={currentHoverX}
              cy={currentHoverY}
              r={4}
              fill={color}
              stroke="#ffffff"
              strokeWidth={1.5}
            />
            <circle
              cx={currentHoverX}
              cy={currentHoverY}
              r={8}
              fill={color}
              fillOpacity={0.15}
            />
          </g>
        )}

        {/* Min/Max Labels */}
        <text x={PAD_X} y={PAD_Y - 4} fill="#705953" fontSize={8} fontWeight="700" opacity={0.4}>
          Max: {formatPrice(maxP)}
        </text>
        <text x={PAD_X} y={H - PAD_Y + 12} fill="#705953" fontSize={8} fontWeight="700" opacity={0.4}>
          Min: {formatPrice(minP)}
        </text>
      </svg>
    </div>
  );
};

// ── Bubble Chart Component ──────────────────────────────────────────────────
const BubbleChart = ({ coins, navigate, watchlist, toggleWatchlist, search }) => {
  const [selectedCoin, setSelectedCoin] = useState(null);

  // States for options
  const viewMode = 'scatter';
  const [sizeMetric, setSizeMetric] = useState('market_cap'); // 'market_cap' | 'total_volume' | 'price_change'
  const [colorMetric, setColorMetric] = useState('24h'); // '1h' | '24h' | '7d'
  const [labelMetric, setLabelMetric] = useState('symbol'); // 'symbol' | 'price' | 'change'
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [draggedId, setDraggedId] = useState(null);

  // SVG parameters
  const W = 1000;
  const H = 550;
  const PAD = { top: 60, right: 60, bottom: 65, left: 85 };

  // Filter valid coins based on selection
  const displayCoins = useMemo(() => {
    let result = coins.filter(c => c.market_cap > 0 && c.total_volume > 0);
    if (watchlistOnly) {
      result = result.filter(c => watchlist?.has(c.id));
    }
    return result.slice(0, 60);
  }, [coins, watchlistOnly, watchlist]);

  // Physics animation hooks
  const bubblesRef = useRef([]);
  const bubbleNodesRef = useRef({});
  const requestRef = useRef(null);
  const svgRef = useRef(null);

  const dragInfo = useRef({
    id: null,
    offsetX: 0,
    offsetY: 0,
    prevMouseX: 0,
    prevMouseY: 0,
    moved: false,
    startX: 0,
    startY: 0,
  });

  const logScale = (val, min, max, outMin, outMax) => {
    const logMin = Math.log10(Math.max(min, 1));
    const logMax = Math.log10(Math.max(max, 1));
    const logVal = Math.log10(Math.max(val, min));
    return outMin + ((logVal - logMin) / (logMax - logMin || 1)) * (outMax - outMin);
  };

  const linearScale = (val, min, max, outMin, outMax) => {
    return outMin + ((val - min) / (max - min || 1)) * (outMax - outMin);
  };

  // Recompute physics bubble bounds and targets when displayCoins or parameters change
  useEffect(() => {
    const currentMap = new Map(bubblesRef.current.map(b => [b.id, b]));

    const mcaps = displayCoins.map(c => c.market_cap || 1);
    const vols = displayCoins.map(c => c.total_volume || 1);
    
    const getChangeVal = (c) => {
      if (colorMetric === '1h') return c.price_change_percentage_1h_in_currency || 0;
      if (colorMetric === '7d') return c.price_change_percentage_7d_in_currency || 0;
      return c.price_change_percentage_24h_in_currency || c.price_change_percentage_24h || 0;
    };
    
    const changes = displayCoins.map(c => Math.abs(getChangeVal(c)));

    const minMcap = Math.min(...mcaps), maxMcap = Math.max(...mcaps);
    const minVol = Math.min(...vols), maxVol = Math.max(...vols);
    const minChg = Math.min(...changes), maxChg = Math.max(...changes);

    const newBubbles = displayCoins.map(coin => {
      const existing = currentMap.get(coin.id);

      // Radius scaling
      let r = 26;
      if (sizeMetric === 'market_cap') {
        r = logScale(coin.market_cap || 1, minMcap, maxMcap, 15, 52);
      } else if (sizeMetric === 'total_volume') {
        r = logScale(coin.total_volume || 1, minVol, maxVol, 15, 52);
      } else if (sizeMetric === 'price_change') {
        r = linearScale(Math.abs(getChangeVal(coin)), minChg, maxChg, 15, 52);
      }

      // Target Coordinates
      let targetX = W / 2;
      let targetY = H / 2;
      if (viewMode === 'scatter') {
        targetX = logScale(coin.market_cap || 1, minMcap, maxMcap, PAD.left, W - PAD.right);
        targetY = H - PAD.bottom - logScale(coin.total_volume || 1, minVol, maxVol, 0, H - PAD.top - PAD.bottom);
      }

      if (existing) {
        return {
          ...existing,
          r,
          targetX,
          targetY,
          coin,
        };
      } else {
        return {
          id: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          image: coin.image,
          x: W / 2 + (Math.random() - 0.5) * 150,
          y: H / 2 + (Math.random() - 0.5) * 150,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          r,
          targetX,
          targetY,
          coin,
        };
      }
    });

    bubblesRef.current = newBubbles;
  }, [displayCoins, viewMode, sizeMetric, colorMetric]);

  // Main physics animation loop
  useEffect(() => {
    const tick = () => {
      const bubbles = bubblesRef.current;
      if (!bubbles.length) {
        requestRef.current = requestAnimationFrame(tick);
        return;
      }

      const damping = 0.83;
      const gravity = viewMode === 'cloud' ? 0.035 : 0.075;
      const collisionElasticity = 0.45;

      // 1. Move bubbles to target positions
      bubbles.forEach(b => {
        if (b.id === dragInfo.current.id) return;

        const dx = b.targetX - b.x;
        const dy = b.targetY - b.y;

        b.vx += dx * gravity;
        b.vy += dy * gravity;

        b.vx *= damping;
        b.vy *= damping;

        b.x += b.vx;
        b.y += b.vy;
      });

      // 2. Resolve Overlap Collisions (2 passes)
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < bubbles.length; i++) {
          for (let j = i + 1; j < bubbles.length; j++) {
            const bi = bubbles[i];
            const bj = bubbles[j];

            const dx = bj.x - bi.x;
            const dy = bj.y - bi.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = bi.r + bj.r + 3;

            if (dist < minDist) {
              const overlap = minDist - dist;
              const ux = dx / (dist || 1);
              const uy = dy / (dist || 1);

              const dragId = dragInfo.current.id;

              if (bi.id !== dragId && bj.id !== dragId) {
                bi.x -= ux * overlap * 0.5;
                bi.y -= uy * overlap * 0.5;
                bj.x += ux * overlap * 0.5;
                bj.y += uy * overlap * 0.5;

                // Adjust velocities on bounce
                const rvx = bj.vx - bi.vx;
                const rvy = bj.vy - bi.vy;
                const velAlongNormal = rvx * ux + rvy * uy;

                if (velAlongNormal < 0) {
                  const impulse = -(1 + collisionElasticity) * velAlongNormal;
                  bi.vx -= ux * impulse * 0.5;
                  bi.vy -= uy * impulse * 0.5;
                  bj.vx += ux * impulse * 0.5;
                  bj.vy += uy * impulse * 0.5;
                }
              } else if (bi.id === dragId) {
                bj.x += ux * overlap;
                bj.y += uy * overlap;
                bj.vx += ux * overlap * 0.2;
                bj.vy += uy * overlap * 0.2;
              } else if (bj.id === dragId) {
                bi.x -= ux * overlap;
                bi.y -= uy * overlap;
                bi.vx -= ux * overlap * 0.2;
                bi.vy -= uy * overlap * 0.2;
              }
            }
          }
        }
      }

      // 3. Border collision resolution
      bubbles.forEach(b => {
        if (b.id === dragInfo.current.id) return;

        const bounce = -0.4;
        const left = b.r + 10;
        const right = W - b.r - 10;
        const top = b.r + 10;
        const bottom = H - b.r - 10;

        if (b.x < left) {
          b.x = left;
          b.vx *= bounce;
        } else if (b.x > right) {
          b.x = right;
          b.vx *= bounce;
        }

        if (b.y < top) {
          b.y = top;
          b.vy *= bounce;
        } else if (b.y > bottom) {
          b.y = bottom;
          b.vy *= bounce;
        }
      });

      // 4. Directly update DOM nodes for smooth rendering
      bubbles.forEach(b => {
        const node = bubbleNodesRef.current[b.id];
        if (node) {
          node.setAttribute('transform', `translate(${b.x.toFixed(2)}, ${b.y.toFixed(2)})`);
        }
      });

      requestRef.current = requestAnimationFrame(tick);
    };

    requestRef.current = requestAnimationFrame(tick);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [viewMode]);

  // Drag handlers
  const handleMouseDown = (e, bubbleId) => {
    e.preventDefault();
    const bubble = bubblesRef.current.find(b => b.id === bubbleId);
    if (!bubble) return;

    const svgNode = svgRef.current;
    if (!svgNode) return;

    const rect = svgNode.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (W / rect.width);
    const mouseY = (e.clientY - rect.top) * (H / rect.height);

    dragInfo.current = {
      id: bubbleId,
      offsetX: mouseX - bubble.x,
      offsetY: mouseY - bubble.y,
      prevMouseX: mouseX,
      prevMouseY: mouseY,
      moved: false,
      startX: mouseX,
      startY: mouseY,
    };

    setDraggedId(bubbleId);

    const handleMouseMove = (event) => {
      if (!dragInfo.current.id) return;
      const b = bubblesRef.current.find(x => x.id === dragInfo.current.id);
      if (!b) return;

      const r = svgNode.getBoundingClientRect();
      const currX = (event.clientX - r.left) * (W / r.width);
      const currY = (event.clientY - r.top) * (H / r.height);

      b.x = currX - dragInfo.current.offsetX;
      b.y = currY - dragInfo.current.offsetY;

      b.vx = currX - dragInfo.current.prevMouseX;
      b.vy = currY - dragInfo.current.prevMouseY;

      dragInfo.current.prevMouseX = currX;
      dragInfo.current.prevMouseY = currY;

      const dist = Math.sqrt(Math.pow(currX - dragInfo.current.startX, 2) + Math.pow(currY - dragInfo.current.startY, 2));
      if (dist > 5) {
        dragInfo.current.moved = true;
      }
    };

    const handleMouseUp = () => {
      const info = dragInfo.current;
      if (info.id) {
        if (!info.moved) {
          const clicked = bubblesRef.current.find(x => x.id === info.id);
          if (clicked) {
            setSelectedCoin(clicked.coin);
          }
        }
      }
      dragInfo.current = { id: null, offsetX: 0, offsetY: 0, prevMouseX: 0, prevMouseY: 0, moved: false, startX: 0, startY: 0 };
      setDraggedId(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleResetPhysics = () => {
    bubblesRef.current.forEach(b => {
      b.x = W / 2 + (Math.random() - 0.5) * 200;
      b.y = H / 2 + (Math.random() - 0.5) * 200;
      b.vx = (Math.random() - 0.5) * 4;
      b.vy = (Math.random() - 0.5) * 4;
    });
  };

  const formatPercent = (val) => {
    if (val === undefined || val === null) return '0.00%';
    return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
  };

  // Precompute grid details for Scatter mode
  const scatterAxisData = useMemo(() => {
    if (viewMode !== 'scatter' || !displayCoins.length) return null;
    const mcaps = displayCoins.map(c => c.market_cap || 1);
    const vols = displayCoins.map(c => c.total_volume || 1);
    const minM = Math.min(...mcaps), maxM = Math.max(...mcaps);
    const minV = Math.min(...vols), maxV = Math.max(...vols);

    const getLogTicks = (min, max, count = 4) => {
      const logMin = Math.log10(min);
      const logMax = Math.log10(max);
      const step = (logMax - logMin) / (count - 1 || 1);
      const ticks = [];
      for (let i = 0; i < count; i++) {
        ticks.push(Math.pow(10, logMin + step * i));
      }
      return ticks;
    };

    return {
      xTicks: getLogTicks(minM, maxM, 5),
      yTicks: getLogTicks(minV, maxV, 4),
      minMcap: minM,
      maxMcap: maxM,
      minVol: minV,
      maxVol: maxV
    };
  }, [displayCoins, viewMode]);

  return (
    <div className="relative w-full h-full flex flex-col gap-4 overflow-hidden select-none">
      
      {/* ── Control Bar ────────────────────────────────────────────────────── */}
      <div className="bg-white/40 backdrop-blur-md rounded-2xl border border-[#556069]/10 p-3 flex flex-wrap items-center justify-between gap-4 z-10">
        
        {/* Title */}
        <div className="flex items-center gap-2 pl-2">
          <TrendingUp size={16} className="text-[#556069]" />
          <span className="text-sm font-extrabold text-[#556069] tracking-tight">Market Scatter Plot</span>
        </div>

        {/* Metrics Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Bubble Size */}
          <div className="flex items-center gap-1 bg-white/60 border border-[#556069]/10 rounded-xl px-2 py-1.5">
            <span className="text-[10px] font-bold text-[#705953] uppercase tracking-wider pl-1">Size:</span>
            <select
              value={sizeMetric}
              onChange={(e) => setSizeMetric(e.target.value)}
              className="text-xs font-bold text-[#556069] bg-transparent outline-none border-none pr-2 cursor-pointer"
            >
              <option value="market_cap">Market Cap</option>
              <option value="total_volume">24h Volume</option>
              <option value="price_change">24h Change Magnitude</option>
            </select>
          </div>

          {/* Timeframe color */}
          <div className="flex items-center gap-1 bg-white/60 border border-[#556069]/10 rounded-xl px-2 py-1.5">
            <span className="text-[10px] font-bold text-[#705953] uppercase tracking-wider pl-1">Timeframe:</span>
            <select
              value={colorMetric}
              onChange={(e) => setColorMetric(e.target.value)}
              className="text-xs font-bold text-[#556069] bg-transparent outline-none border-none pr-2 cursor-pointer"
            >
              <option value="1h">1 Hour</option>
              <option value="24h">24 Hours</option>
              <option value="7d">7 Days</option>
            </select>
          </div>

          {/* Central Label */}
          <div className="flex items-center gap-1 bg-white/60 border border-[#556069]/10 rounded-xl px-2 py-1.5">
            <span className="text-[10px] font-bold text-[#705953] uppercase tracking-wider pl-1">Label:</span>
            <select
              value={labelMetric}
              onChange={(e) => setLabelMetric(e.target.value)}
              className="text-xs font-bold text-[#556069] bg-transparent outline-none border-none pr-2 cursor-pointer"
            >
              <option value="symbol">Symbol Only</option>
              <option value="price">Price</option>
              <option value="change">Change %</option>
            </select>
          </div>

          {/* Watchlist toggle */}
          <button
            onClick={() => setWatchlistOnly(!watchlistOnly)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              watchlistOnly
                ? 'bg-amber-400 text-[#556069] border-amber-400 shadow-sm'
                : 'bg-white/60 text-[#556069] border-[#556069]/10 hover:bg-white'
            }`}
          >
            <Star size={13} className={watchlistOnly ? 'fill-[#556069] text-[#556069]' : ''} />
            Watchlist Only
          </button>
        </div>

        {/* Physics resets / helpers */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetPhysics}
            title="Re-disperse Bubbles"
            className="p-2 bg-white/60 hover:bg-white text-[#556069] border border-[#556069]/10 rounded-xl transition-all cursor-pointer"
          >
            <RotateCcw size={14} />
          </button>
          <div className="flex items-center gap-3 text-[10px] font-bold text-[#556069]/60 uppercase tracking-wider pr-1">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> Up</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-400 inline-block" /> Down</span>
          </div>
        </div>
      </div>

      {/* ── Main Canvas ────────────────────────────────────────────────────── */}
      <div className="relative flex-grow bg-white/20 rounded-3xl border border-[#556069]/5 overflow-hidden shadow-inner flex">
        {displayCoins.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-8 text-center text-[#705953]/60">
            <Sparkles size={36} className="text-[#556069]/20" />
            <p className="font-bold text-sm">No bubbles found</p>
            <p className="text-xs">Try clearing your filters or search terms.</p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full block"
          >
            {/* Global clip path definition for coin logos */}
            <defs>
              <clipPath id="circle-clip" clipPathUnits="objectBoundingBox">
                <circle cx="0.5" cy="0.5" r="0.5" />
              </clipPath>
            </defs>

            {/* Scatter Axis Background */}
            {viewMode === 'scatter' && scatterAxisData && (
              <g className="fade-in duration-300">
                <rect x={PAD.left} y={PAD.top} width={W - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom}
                  rx={16} fill="rgba(85,96,105,0.015)" stroke="rgba(85,96,105,0.06)" strokeWidth={1} />
                
                {/* Vertical grid lines (Market Cap) */}
                {scatterAxisData.xTicks.map((v, i) => {
                  const x = logScale(v, scatterAxisData.minMcap, scatterAxisData.maxMcap, PAD.left, W - PAD.right);
                  return (
                    <g key={`xg-${i}`}>
                      <line x1={x} y1={PAD.top} x2={x} y2={H - PAD.bottom} stroke="rgba(85,96,105,0.06)" strokeDasharray="4 4" />
                      <text x={x} y={H - PAD.bottom + 18} textAnchor="middle" fill="#705953" fontSize={9} fontWeight="700" opacity={0.5}>
                        {v >= 1e12 ? `$${(v/1e12).toFixed(0)}T` : v >= 1e9 ? `$${(v/1e9).toFixed(0)}B` : `$${(v/1e6).toFixed(0)}M`}
                      </text>
                    </g>
                  );
                })}

                {/* Horizontal grid lines (Volume) */}
                {scatterAxisData.yTicks.map((v, i) => {
                  const y = H - PAD.bottom - logScale(v, scatterAxisData.minVol, scatterAxisData.maxVol, 0, H - PAD.top - PAD.bottom);
                  return (
                    <g key={`yg-${i}`}>
                      <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(85,96,105,0.06)" strokeDasharray="4 4" />
                      <text x={PAD.left - 12} y={y + 3} textAnchor="end" fill="#705953" fontSize={9} fontWeight="700" opacity={0.5}>
                        {v >= 1e9 ? `$${(v/1e9).toFixed(0)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : `$${(v/1e3).toFixed(0)}K`}
                      </text>
                    </g>
                  );
                })}

                {/* Axis Labels */}
                <text x={(PAD.left + W - PAD.right) / 2} y={H - 8} textAnchor="middle" fill="#705953" fontSize={10} fontWeight="800" letterSpacing={1.2} opacity={0.6}>
                  MARKET CAP (LOG SCALE)
                </text>
                <text transform="rotate(-90)" x={-(PAD.top + H - PAD.bottom) / 2} y={24} textAnchor="middle" fill="#705953" fontSize={10} fontWeight="800" letterSpacing={1.2} opacity={0.6}>
                  24H TRADING VOLUME (LOG SCALE)
                </text>
              </g>
            )}

            {/* Bubble rendering */}
            {bubblesRef.current.map(b => {
              const coin = b.coin;
              const isWatched = watchlist?.has(b.id);
              const isSelected = selectedCoin?.id === b.id;
              
              const changeVal = colorMetric === '1h' ? coin.price_change_percentage_1h_in_currency :
                                colorMetric === '7d' ? coin.price_change_percentage_7d_in_currency :
                                coin.price_change_percentage_24h_in_currency || coin.price_change_percentage_24h;
              
              const isUp = (changeVal || 0) >= 0;

              const isMatched = !search || 
                                coin.name.toLowerCase().includes(search.toLowerCase()) || 
                                coin.symbol.toLowerCase().includes(search.toLowerCase());
              
              return (
                <g
                  key={b.id}
                  ref={el => {
                    if (el) bubbleNodesRef.current[b.id] = el;
                    else delete bubbleNodesRef.current[b.id];
                  }}
                  onMouseDown={(e) => isMatched && handleMouseDown(e, b.id)}
                  style={{
                    cursor: isMatched ? 'grab' : 'default',
                    opacity: isMatched ? 1 : 0.15,
                    pointerEvents: isMatched ? 'auto' : 'none',
                    transition: 'opacity 0.3s',
                  }}
                  className="select-none active:cursor-grabbing"
                >
                  {/* Selected ring */}
                  {isSelected && (
                    <circle cx={0} cy={0} r={b.r + 8} fill="none" stroke="#556069" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.6} className="animate-spin" style={{ transformOrigin: '0 0', animationDuration: '8s' }} />
                  )}

                   {/* Bubble Circle */}
                  <circle
                    cx={0}
                    cy={0}
                    r={b.r}
                    fill={isUp ? '#ecfdf5' : '#fff1f2'}
                    stroke={isSelected ? '#556069' : isWatched ? '#fbbf24' : isUp ? '#10b981' : '#f43f5e'}
                    strokeWidth={isSelected ? 4 : isWatched ? 3 : Math.max(2, b.r * 0.08)}
                    className="transition-all hover:brightness-105 duration-200"
                  />

                  {/* Coin logo (centered inside the bubble, occupying 85% width) */}
                  <image
                    href={b.image}
                    x={-b.r * 0.85}
                    y={-b.r * 0.85}
                    width={b.r * 1.7}
                    height={b.r * 1.7}
                    clipPath="url(#circle-clip)"
                    className="pointer-events-none"
                  />

                  {/* Symbol */}
                  {b.r >= 14 && (
                    <text
                      x={0}
                      y={b.r >= 28 ? b.r * 0.45 : 3}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={b.r >= 34 ? 10 : b.r >= 28 ? 9 : 8}
                      fontWeight="900"
                      stroke="#1e293b"
                      strokeWidth={2}
                      paintOrder="stroke"
                      className="pointer-events-none select-none font-headline"
                    >
                      {b.symbol.toUpperCase()}
                    </text>
                  )}

                  {/* Detail labels */}
                  {b.r >= 32 && labelMetric !== 'symbol' && (
                    <text
                      x={0}
                      y={b.r * 0.76}
                      textAnchor="middle"
                      fill="rgba(255, 255, 255, 0.95)"
                      fontSize={b.r >= 42 ? 8.5 : 7.5}
                      fontWeight="800"
                      stroke="#1e293b"
                      strokeWidth={2}
                      paintOrder="stroke"
                      className="pointer-events-none select-none font-body"
                    >
                      {labelMetric === 'price' ? formatPrice(coin.current_price) : formatPercent(changeVal)}
                    </text>
                  )}

                  {/* Watchlist Star indicator */}
                  {isWatched && (
                    <path
                      d="M0,-4 L1.1,-1.2 L4.1,-1.2 L1.7,0.5 L2.6,3.3 L0,1.6 L-2.6,3.3 L-1.7,0.5 L-4.1,-1.2 L-1.1,-1.2 Z"
                      fill="#fbbf24"
                      stroke="#ffffff"
                      strokeWidth={0.5}
                      transform={`translate(${b.r * 0.55}, ${-b.r * 0.55}) scale(${b.r >= 28 ? 1.2 : 0.85})`}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* ── Sliding Drawer Panel ───────────────────────────────────────────── */}
        <AnimatePresence>
          {selectedCoin && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute right-0 top-0 h-full w-full sm:w-96 bg-white/95 backdrop-blur-md border-l border-[#556069]/10 shadow-2xl p-6 z-40 flex flex-col justify-between overflow-y-auto no-scrollbar font-body"
            >
              <div>
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                  <span className="text-xs font-bold text-[#705953]/60 uppercase tracking-widest">Coin Analytics</span>
                  <button
                    onClick={() => setSelectedCoin(null)}
                    className="p-1.5 bg-[#556069]/5 hover:bg-[#556069]/10 text-[#556069] rounded-lg transition-all cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Coin Info */}
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <img src={selectedCoin.image} className="w-12 h-12 rounded-full bg-white p-0.5 border border-[#556069]/10" alt={selectedCoin.name} />
                    <div>
                      <h3 className="font-headline font-bold text-xl text-[#556069] leading-tight flex items-center gap-2">
                        {selectedCoin.name}
                        <span className="text-[10px] uppercase font-bold text-[#705953] tracking-wide bg-[#556069]/5 px-2 py-0.5 rounded-full select-none">
                          {selectedCoin.symbol}
                        </span>
                      </h3>
                      <span className="text-xs font-bold text-[#705953]/70">
                        Rank #{selectedCoin.market_cap_rank || '—'}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleWatchlist(selectedCoin.id)}
                    className={`flex items-center justify-center p-2.5 rounded-xl border transition-all cursor-pointer ${
                      watchlist?.has(selectedCoin.id)
                        ? 'bg-amber-50 text-amber-500 border-amber-200 hover:bg-amber-100'
                        : 'bg-white hover:bg-gray-50 text-[#556069]/50 border-[#556069]/10 hover:text-[#556069]'
                    }`}
                    title={watchlist?.has(selectedCoin.id) ? "Remove from watchlist" : "Add to watchlist"}
                  >
                    <Star size={16} className={watchlist?.has(selectedCoin.id) ? 'fill-amber-400 text-amber-400' : ''} />
                  </button>
                </div>

                {/* Price Display */}
                <div className="bg-[#556069]/5 rounded-2xl p-4 mb-6">
                  <div className="text-center">
                    <span className="text-[10px] font-bold text-[#705953]/60 uppercase tracking-widest block mb-1">Current Price</span>
                    <span className="text-3xl font-extrabold text-[#556069] font-headline tabular-nums">
                      {formatPrice(selectedCoin.current_price)}
                    </span>
                  </div>

                  {/* Performance percentages */}
                  <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#556069]/10 text-center">
                    <div>
                      <span className="text-[9px] font-bold text-[#705953]/60 uppercase tracking-wider block mb-1">1h</span>
                      <span className={`text-xs font-extrabold tabular-nums ${
                        (selectedCoin.price_change_percentage_1h_in_currency ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-500'
                      }`}>
                        {formatPercent(selectedCoin.price_change_percentage_1h_in_currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-[#705953]/60 uppercase tracking-wider block mb-1">24h</span>
                      <span className={`text-xs font-extrabold tabular-nums ${
                        (selectedCoin.price_change_percentage_24h_in_currency ?? selectedCoin.price_change_percentage_24h ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-500'
                      }`}>
                        {formatPercent(selectedCoin.price_change_percentage_24h_in_currency ?? selectedCoin.price_change_percentage_24h)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-[#705953]/60 uppercase tracking-wider block mb-1">7d</span>
                      <span className={`text-xs font-extrabold tabular-nums ${
                        (selectedCoin.price_change_percentage_7d_in_currency ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-500'
                      }`}>
                        {formatPercent(selectedCoin.price_change_percentage_7d_in_currency)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Key Statistics */}
                <div className="space-y-3 mb-6 text-sm">
                  <div className="flex justify-between items-center py-2 border-b border-[#556069]/5">
                    <span className="font-bold text-[#705953]/60 text-xs uppercase tracking-wider">Market Cap</span>
                    <span className="font-extrabold text-[#556069] tabular-nums">{formatLargeNum(selectedCoin.market_cap)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-[#556069]/5">
                    <span className="font-bold text-[#705953]/60 text-xs uppercase tracking-wider">24h Volume</span>
                    <span className="font-extrabold text-[#556069] tabular-nums">{formatLargeNum(selectedCoin.total_volume)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-[#556069]/5">
                    <span className="font-bold text-[#705953]/60 text-xs uppercase tracking-wider">24h High</span>
                    <span className="font-extrabold text-[#556069] tabular-nums">{formatPrice(selectedCoin.high_24h)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-[#556069]/5">
                    <span className="font-bold text-[#705953]/60 text-xs uppercase tracking-wider">24h Low</span>
                    <span className="font-extrabold text-[#556069] tabular-nums">{formatPrice(selectedCoin.low_24h)}</span>
                  </div>
                  {selectedCoin.circulating_supply && (
                    <div className="flex justify-between items-center py-2 border-b border-[#556069]/5">
                      <span className="font-bold text-[#705953]/60 text-xs uppercase tracking-wider">Circulating Supply</span>
                      <span className="font-extrabold text-[#556069] tabular-nums">
                        {selectedCoin.circulating_supply.toLocaleString('en-US', { maximumFractionDigits: 0 })} {selectedCoin.symbol?.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* 7d Sparkline */}
                <div className="bg-white border border-[#556069]/10 rounded-2xl p-4 shadow-sm">
                  <InteractiveDrawerSparkline
                    prices={selectedCoin.sparkline_in_7d?.price}
                    isPositive={(selectedCoin.price_change_percentage_24h_in_currency ?? selectedCoin.price_change_percentage_24h ?? 0) >= 0}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-8 flex flex-col gap-3">
                <button
                  onClick={() => navigate(`/coin/${selectedCoin.id}`)}
                  className="w-full bg-[#556069] hover:bg-[#3e4851] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-[#556069]/20"
                >
                  <Sparkles size={14} />
                  Deep-dive Analysis
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setSelectedCoin(null)}
                  className="w-full bg-gray-50 hover:bg-gray-100 text-[#556069] py-2.5 rounded-xl font-bold transition-all border border-[#556069]/10 text-xs cursor-pointer"
                >
                  Close Panel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const Market = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [watchlist, setWatchlist] = useState(new Set());
  const [activeFilter, setActiveFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [countdown, setCountdown] = useState(10);
  const [syncing, setSyncing] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'heatmap' | 'bubble'
  const countdownRef = useRef(null);
  const navigate = useNavigate();

  const { user, token, BACKEND_URL } = useAuth();
  const {
    coins: cryptos,
    lastUpdated: realtimeLastUpdated,
    realtimeStatus,
    refreshCoins,
  } = CryptoState();

  const loading = !cryptos || cryptos.length === 0;
  const error = realtimeStatus?.connected ? null : realtimeStatus?.lastError;
  const online = realtimeStatus?.connected || realtimeStatus?.source !== 'offline';
  const lastUpdated = realtimeLastUpdated;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshCoins();
    } finally {
      setIsRefreshing(false);
      setCountdown(10);
    }
  };

  // Sync user's watchlist from DB on load
  useEffect(() => {
    if (user && user.bookmarks) {
      setWatchlist(new Set(user.bookmarks));
    }
  }, [user]);

  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCountdown((p) => (p <= 1 ? 10 : p - 1));
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, []);

  const syncWatchlistToCloud = async (currentWatchlist) => {
    if (!user) return;
    setSyncing(true);
    try {
      await fetch(`${BACKEND_URL}/api/save`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ bookmarks: Array.from(currentWatchlist), alerts: [] })
      });
    } catch (error) {
      console.error("Error auto-syncing watchlist to cloud:", error);
    } finally {
      setSyncing(false);
    }
  };

  const toggleWatchlist = (id) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      syncWatchlistToCloud(next);
      return next;
    });
  };

  const filtered = cryptos.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.symbol.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="pt-28 pb-20 px-4 md:px-8 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 gap-6">
        <div className="space-y-2">
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="font-headline text-4xl md:text-5xl font-extrabold tracking-tight text-[#556069]"
          >
            Live Market
          </motion.h1>
          <p className="text-[#705953] text-base max-w-xl">
            Real-time prices from CoinGecko — auto-refresh every 10 s.
          </p>
        </div>

        <div className="flex items-center gap-4">
          {syncing && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-4 py-2 rounded-full select-none animate-pulse">
              <Loader2 size={13} className="animate-spin text-blue-500" />
              <span className="text-blue-700 text-xs font-bold">SYNCING</span>
            </div>
          )}
          {online ? (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-full">
              <LiveDot />
              <span className="text-emerald-700 text-xs font-bold">
                LIVE — refreshing in {countdown}s
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 px-4 py-2 rounded-full">
              <WifiOff size={14} className="text-rose-500" />
              <span className="text-rose-700 text-xs font-bold">Offline</span>
            </div>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 bg-[#556069] text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-[#3e4851] transition-all disabled:opacity-50"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {!user && (
        <div className="bg-amber-50 p-6 rounded-3xl mb-8 border border-amber-200 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-100 rounded-2xl">
              <User className="text-amber-600" size={24} />
            </div>
            <div>
              <h3 className="text-amber-900 font-bold">Sync disabled</h3>
              <p className="text-amber-700/70 text-sm">Login to save your watchlist across devices.</p>
            </div>
          </div>
          <Link to="/login" className="px-6 py-2.5 bg-amber-600 text-white rounded-xl font-bold text-sm hover:bg-amber-700 transition-all shadow-md">
            Login to Sync
          </Link>
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative max-w-sm w-full">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#556069]/40" />
          <input
            type="text"
            placeholder="Search coins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white/60 border border-[#556069]/10 rounded-xl text-sm text-[#556069] placeholder:text-[#556069]/30 focus:outline-none focus:border-[#556069]/30"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-4 py-2 rounded-full font-medium text-sm transition-all ${
                activeFilter === f
                  ? 'bg-[#556069] text-white shadow-md shadow-[#556069]/20'
                  : 'bg-white/50 text-[#556069] border border-[#556069]/10 hover:bg-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex justify-end mb-6">
        <div className="flex bg-[#556069]/5 p-1 rounded-xl border border-[#556069]/5">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              viewMode === 'list'
                ? 'bg-[#556069] text-white shadow-sm'
                : 'text-[#556069]/60 hover:text-[#556069]'
            }`}
          >
            <List size={16} /> List
          </button>
          <button
            onClick={() => setViewMode('heatmap')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              viewMode === 'heatmap'
                ? 'bg-[#556069] text-white shadow-sm'
                : 'text-[#556069]/60 hover:text-[#556069]'
            }`}
          >
            <LayoutGrid size={16} /> Heatmap
          </button>
          <button
            onClick={() => setViewMode('bubble')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              viewMode === 'bubble'
                ? 'bg-[#556069] text-white shadow-sm'
                : 'text-[#556069]/60 hover:text-[#556069]'
            }`}
          >
            <CircleDot size={16} /> Bubble
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3">
          <WifiOff size={18} className="text-rose-500 shrink-0" />
          <p className="text-rose-700 text-sm font-medium">
            Could not fetch: {error}. Retrying automatically…
          </p>
        </div>
      )}

      {/* Main Content Area */}
      {viewMode === 'bubble' ? (
        <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-[#556069]/5 p-4 shadow-2xl shadow-[#556069]/5" style={{ height: '75vh', minHeight: 620 }}>
          {loading ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 size={32} className="animate-spin text-[#556069]/30" />
            </div>
          ) : (
            <BubbleChart coins={filtered} navigate={navigate} watchlist={watchlist} toggleWatchlist={toggleWatchlist} search={search} />
          )}
        </div>
      ) : viewMode === 'heatmap' ? (
        <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-[#556069]/5 p-2 shadow-2xl shadow-[#556069]/5" style={{ height: '75vh', minHeight: 600 }}>
          {loading ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 size={32} className="animate-spin text-[#556069]/30" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={filtered.slice(0, 100).map(c => ({
                  name: c.name,
                  symbol: c.symbol,
                  // Use Math.pow to balance block sizes so BTC doesn't take 50% of screen
                  size: Math.pow(c.market_cap || 1, 0.35), 
                  price_change: c.price_change_percentage_24h_in_currency || c.price_change_percentage_24h || 0,
                  id: c.id,
                  image: c.image
                }))}
                dataKey="size"
                aspectRatio={4 / 3}
                stroke="transparent"
                content={<CustomTreemapContent navigate={navigate} />}
                isAnimationActive={true}
              >
                <Tooltip content={<CustomTreemapTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          )}
        </div>
      ) : (
        <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-[#556069]/5 overflow-hidden shadow-2xl shadow-[#556069]/5">
          {loading ? (
            <SkeletonTable />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-0">
              <thead>
                <tr className="bg-[#556069]/5 text-[#556069]/60 text-[11px] font-bold uppercase tracking-wider">
                  <th className="py-5 px-5">
                    <Star size={13} />
                  </th>
                  <th className="py-5 px-3">#</th>
                  <th className="py-5 px-4" style={{ minWidth: 200 }}>Coin</th>
                  <th className="py-5 px-4">Price</th>
                  <th className="py-5 px-4">1h %</th>
                  <th className="py-5 px-4">24h %</th>
                  <th className="py-5 px-4">7d %</th>
                  <th className="py-5 px-4 text-right">Market Cap</th>
                  <th className="py-5 px-4 text-right">Vol 24h</th>
                  <th className="py-5 px-5 text-center" style={{ minWidth: 140 }}>7d Chart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#556069]/5 text-sm">
                <AnimatePresence>
                  {filtered.map((coin, idx) => {
                    const is24hUp = (coin.price_change_percentage_24h_in_currency ?? 0) >= 0;
                    const sparkPrices = coin.sparkline_in_7d?.price ?? [];
                    const isWatched = watchlist.has(coin.id);
                    return (
                      <motion.tr
                        key={coin.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.025, duration: 0.25 }}
                        className="hover:bg-white/70 transition-colors group cursor-pointer"
                      >
                        {/* Star */}
                        <td className="py-4 px-5">
                          <button onClick={() => toggleWatchlist(coin.id)}>
                            <Star
                              size={15}
                              className={`transition-colors ${
                                isWatched
                                  ? 'text-amber-400 fill-amber-400'
                                  : 'text-[#556069]/20 group-hover:text-amber-400'
                              }`}
                            />
                          </button>
                        </td>

                        {/* Rank */}
                        <td className="py-4 px-3 font-medium text-[#705953] text-sm">
                          {coin.market_cap_rank}
                        </td>

                        {/* Name */}
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={coin.image}
                              alt={coin.symbol}
                              width={36} height={36}
                              className="rounded-full bg-white p-0.5 shadow-sm border border-[#556069]/5 object-contain"
                            />
                            <div>
                              <Link
                                to={`/coin/${coin.id}`}
                                className="font-bold text-[#556069] block leading-tight hover:underline"
                              >
                                {coin.name}
                              </Link>
                              <span className="text-[#705953] text-[11px] font-semibold uppercase tracking-wide">
                                {coin.symbol}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Price */}
                        <td className="py-4 px-4 font-bold text-[#556069] tabular-nums whitespace-nowrap">
                          {formatPrice(coin.current_price)}
                        </td>

                        {/* 1h / 24h / 7d */}
                        <PriceCell val={coin.price_change_percentage_1h_in_currency} />
                        <PriceCell val={coin.price_change_percentage_24h_in_currency} />
                        <PriceCell val={coin.price_change_percentage_7d_in_currency} />

                        {/* Market Cap */}
                        <td className="py-4 px-4 text-right font-medium text-[#556069] tabular-nums whitespace-nowrap">
                          {formatLargeNum(coin.market_cap)}
                        </td>

                        {/* Volume */}
                        <td className="py-4 px-4 text-right font-medium text-[#556069] tabular-nums whitespace-nowrap">
                          {formatLargeNum(coin.total_volume)}
                        </td>

                        {/* Sparkline */}
                        <td className="py-4 px-5">
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            <SparklineChart prices={sparkPrices} isPositive={is24hUp} />
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}

        {/* Footer row */}
        <div className="px-8 py-4 border-t border-[#556069]/5 flex flex-col md:flex-row items-center justify-between gap-3">
          <span className="text-[#705953]/60 text-xs font-medium">
            Showing <span className="font-bold text-[#556069]">{filtered.length}</span> coins · Source: {realtimeStatus?.source === 'aws-kinesis' ? 'AWS Kinesis' : 'CoinGecko fallback'}
          </span>
          {lastUpdated && (
            <span className="text-[#556069]/40 text-xs">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
      )}

      {/* Watchlist toast */}
      {watchlist.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 flex items-center gap-3 bg-amber-50 border border-amber-200 px-6 py-3 rounded-2xl"
        >
          <Star size={15} className="text-amber-400 fill-amber-400 shrink-0" />
          <p className="text-amber-700 text-sm font-medium">
            {watchlist.size} coin{watchlist.size > 1 ? 's' : ''} in your watchlist
          </p>
        </motion.div>
      )}
    </div>
  );
};

// ── Price change cell ────────────────────────────────────────────────────────
const PriceCell = ({ val }) => {
  const isUp = (val ?? 0) >= 0;
  return (
    <td className={`py-4 px-4 font-bold tabular-nums ${isUp ? 'text-emerald-600' : 'text-rose-500'}`}>
      <div className="flex items-center gap-0.5 whitespace-nowrap">
        {isUp ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
        {Math.abs(val ?? 0).toFixed(2)}%
      </div>
    </td>
  );
};

// ── Skeleton loader ──────────────────────────────────────────────────────────
const SkeletonTable = () => (
  <div className="p-8 space-y-5">
    {Array.from({ length: 10 }).map((_, i) => (
      <div key={i} className="flex items-center gap-5">
        <div className="w-9 h-9 bg-[#556069]/10 rounded-full animate-pulse shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 bg-[#556069]/10 rounded w-32 animate-pulse" />
          <div className="h-2.5 bg-[#556069]/5 rounded w-16 animate-pulse" />
        </div>
        <div className="h-3.5 bg-[#556069]/10 rounded w-20 animate-pulse" />
        <div className="h-3.5 bg-emerald-100 rounded w-14 animate-pulse" />
        <div className="h-3.5 bg-[#556069]/10 rounded w-24 animate-pulse" />
        <div className="h-10 bg-[#556069]/5 rounded-lg w-28 animate-pulse" />
      </div>
    ))}
  </div>
);

export default Market;
