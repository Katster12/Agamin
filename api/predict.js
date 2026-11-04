const ML_API_URL = (process.env.ML_API_URL || "https://mitsubishi-prospects-answers-poultry.trycloudflare.com").replace(/\/$/, "");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Only POST allowed" });
  }
  const coin = String(req.body?.coin || "").trim();
  if (!coin) return res.status(400).json({ success: false, error: "coin is required" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const upstream = await fetch(`${ML_API_URL}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coin, horizons: req.body?.horizons }),
      signal: controller.signal,
    });
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { success: false, error: "ML service returned an invalid response" }; }
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(upstream.status).json(data);
  } catch (error) {
    const message = error.name === "AbortError" ? "ML service timed out" : "ML service unavailable";
    return res.status(503).json({ success: false, error: message });
  } finally {
    clearTimeout(timeout);
  }
}
