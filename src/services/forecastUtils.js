export const compute1DForecastData = (prices, prediction) => {
  if (!prices || prices.length < 2) return null;

  const vals = prices.map((point) => point[1]);
  const currentPrice = vals[vals.length - 1];
  const startPrice = vals[0];
  const change24h = ((currentPrice - startPrice) / startPrice) * 100;

  // Use the deployed 24-hour model directly. Historical momentum is only a
  // fallback while the live model response is loading.
  const modelChange = Number(prediction?.change);
  const avgChangePct = Number.isFinite(modelChange) ? modelChange : change24h * 0.4;

  const returns = [];
  for (let i = 1; i < vals.length; i += 1) {
    returns.push((vals[i] - vals[i - 1]) / vals[i - 1]);
  }
  const meanRet = returns.reduce((sum, value) => sum + value, 0) / (returns.length || 1);
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - meanRet, 2), 0) / (returns.length || 1);
  const hourlyStd = Math.sqrt(variance);
  const dailyVolatilityPct = Math.min(22, Math.max(4.5, hourlyStd * Math.sqrt(24) * 100 * 1.6));

  const maxChangePct = Math.max(avgChangePct + dailyVolatilityPct, dailyVolatilityPct * 0.9);
  const minChangePct = Math.min(avgChangePct - dailyVolatilityPct, -dailyVolatilityPct * 0.85);
  const avgPrice = currentPrice * (1 + avgChangePct / 100);
  const maxPrice = currentPrice * (1 + maxChangePct / 100);
  const minPrice = currentPrice * (1 + minChangePct / 100);

  return {
    currentPrice,
    avgPrice,
    maxPrice,
    minPrice,
    avgChangePct,
    maxChangePct,
    minChangePct,
    diff: avgPrice - currentPrice,
    diffPct: avgChangePct,
  };
};
