export const getCoinPrediction = async (coinId) => {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=7`
  );

  const data = await res.json();

  const prices = data.prices.map((p) => p[1]);

  const currentPrice = prices[prices.length - 1];
  const oldPrice = prices[0];

  const change = ((currentPrice - oldPrice) / oldPrice) * 100;

  const predictedPrice =
    currentPrice * (1 + change / 100 / 2);

  return {
    currentPrice: currentPrice.toFixed(2),
    predictedPrice: predictedPrice.toFixed(2),
    change: change.toFixed(2),
    signal: change >= 0 ? "Bullish" : "Bearish",
    confidence: Math.min(Math.abs(change) * 5 + 50, 95).toFixed(0),
  };
};