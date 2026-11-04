export const getCoinPrediction = async (coinId) => {
  const response = await fetch('/api/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coin: coinId, horizons: ['30min'] }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Prediction unavailable');
  const prediction = data.predictions[0];
  return {
    currentPrice: prediction.current_price,
    predictedPrice: prediction.price_target,
    change: prediction.predicted_return_pct,
    signal: prediction.direction,
    asOf: prediction.as_of,
    cacheStatus: prediction.cache_status,
    evaluation: prediction.evaluation,
  };
};
