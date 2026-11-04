export const getCoinPrediction = async (coinId) => {
  const response = await fetch('/api/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coin: coinId, horizons: ['30min', '12h', '24h'] }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Prediction unavailable');
  const predictions = data.predictions || [];
  const prediction = predictions.find((item) => item.horizon === '24h') || predictions[0];
  if (!prediction) throw new Error('Prediction unavailable');
  return {
    currentPrice: prediction.current_price,
    predictedPrice: prediction.price_target,
    change: prediction.predicted_return_pct,
    signal: prediction.direction,
    asOf: prediction.as_of,
    cacheStatus: prediction.cache_status,
    evaluation: prediction.evaluation,
    horizon: prediction.horizon,
    predictions,
    warning: data.warning,
  };
};
