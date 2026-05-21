import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext";

const Crypto = createContext();

const TRACKED_IDS = "aave,cardano,avalanche-2,binancecoin,bitcoin,polkadot,ethereum,litecoin,pepe,matic-network,shiba-inu,solana,sui,tron,uniswap,ripple";
const CG_API_KEY = "CG-XgRkwptpUH4LFa6Mub8chHXH";
const FALLBACK_REFRESH_MS = 60000;

const getWebSocketUrl = (backendUrl) => {
  const explicitUrl = import.meta.env.VITE_REALTIME_WS_URL;
  if (explicitUrl) return explicitUrl;

  try {
    const url = new URL(backendUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    return url.toString();
  } catch {
    return "ws://localhost:5000/ws";
  }
};

const mergeCoinUpdates = (currentCoins, incomingCoins) => {
  if (!Array.isArray(incomingCoins) || !incomingCoins.length) return currentCoins;

  const currentById = new Map(currentCoins.map((coin) => [coin.id || coin.symbol, coin]));

  incomingCoins.forEach((coin) => {
    const key = coin.id || coin.symbol;
    if (!key) return;
    currentById.set(key, { ...(currentById.get(key) || {}), ...coin });
  });

  return Array.from(currentById.values()).sort((a, b) => {
    const aRank = a.market_cap_rank ?? Number.MAX_SAFE_INTEGER;
    const bRank = b.market_cap_rank ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
};

const CryptoContext = ({ children }) => {
  const { user, BACKEND_URL } = useAuth();
  const [coins, setCoins] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState({
    connected: false,
    source: "fallback",
    lastError: null,
  });
  const alertsRef = useRef(alerts);
  const realtimeConnectedRef = useRef(false);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  useEffect(() => {
    realtimeConnectedRef.current = realtimeStatus.connected;
  }, [realtimeStatus.connected]);

  useEffect(() => {
    if (user) {
      setWatchlist(user.bookmarks || []);
      setAlerts(user.alerts || []);
    } else {
      setWatchlist([]);
      setAlerts([]);
    }
  }, [user]);

  const checkAlerts = useCallback((coinData) => {
    alertsRef.current.forEach((alertItem) => {
      const coin = coinData.find((c) => c.id === alertItem.id);
      if (coin && coin.current_price >= alertItem.value) {
        alert(`Alert: ${coin.name} has hit your target of $${alertItem.value}!`);
      }
    });
  }, []);

  const fetchCoins = useCallback(async () => {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${TRACKED_IDS}&order=market_cap_desc&sparkline=true&price_change_percentage=1h%2C24h%2C7d`,
        { headers: { "x-cg-demo-api-key": CG_API_KEY } }
      );

      if (!res.ok) throw new Error(`CoinGecko API error ${res.status}`);

      const data = await res.json();
      setCoins(data);
      setLastUpdated(new Date());
      setRealtimeStatus((prev) => ({
        ...prev,
        source: prev.connected ? prev.source : "coingecko-fallback",
        lastError: null,
      }));
      checkAlerts(data);
      return data;
    } catch (error) {
      setRealtimeStatus((prev) => ({
        ...prev,
        source: prev.connected ? prev.source : "offline",
        lastError: error.message,
      }));
      throw error;
    }
  }, [checkAlerts]);

  useEffect(() => {
    fetchCoins().catch(() => {});
    const interval = setInterval(() => {
      if (!realtimeConnectedRef.current) {
        fetchCoins().catch(() => {});
      }
    }, FALLBACK_REFRESH_MS);

    return () => clearInterval(interval);
  }, [fetchCoins]);

  useEffect(() => {
    const wsUrl = getWebSocketUrl(BACKEND_URL);
    let socket;
    let reconnectTimer;
    let shouldReconnect = true;

    const connect = () => {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setRealtimeStatus((prev) => ({
          ...prev,
          connected: true,
          source: "aws-kinesis",
          lastError: null,
        }));
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "realtime:status") {
            setRealtimeStatus((prev) => ({
              ...prev,
              ...message.data,
              connected: true,
            }));
            return;
          }

          if (message.type === "crypto:update") {
            setCoins((currentCoins) => {
              const nextCoins = mergeCoinUpdates(currentCoins, message.data);
              checkAlerts(nextCoins);
              return nextCoins;
            });
            setLastUpdated(message.receivedAt ? new Date(message.receivedAt) : new Date());
            setRealtimeStatus((prev) => ({
              ...prev,
              connected: true,
              source: message.source || "aws-kinesis",
              lastError: null,
            }));
          }
        } catch (error) {
          setRealtimeStatus((prev) => ({
            ...prev,
            lastError: error.message,
          }));
        }
      };

      socket.onerror = () => {
        setRealtimeStatus((prev) => ({
          ...prev,
          connected: false,
          source: "coingecko-fallback",
          lastError: "Realtime WebSocket unavailable",
        }));
      };

      socket.onclose = () => {
        setRealtimeStatus((prev) => ({
          ...prev,
          connected: false,
          source: "coingecko-fallback",
        }));

        if (shouldReconnect) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      };
    };

    connect();

    return () => {
      shouldReconnect = false;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [BACKEND_URL, checkAlerts]);

  const value = useMemo(() => ({
    coins,
    watchlist,
    setWatchlist,
    alerts,
    setAlerts,
    lastUpdated,
    realtimeStatus,
    refreshCoins: fetchCoins,
  }), [alerts, coins, fetchCoins, lastUpdated, realtimeStatus, watchlist]);

  return (
    <Crypto.Provider value={value}>
      {children}
    </Crypto.Provider>
  );
};

export default CryptoContext;
export const CryptoState = () => useContext(Crypto);
