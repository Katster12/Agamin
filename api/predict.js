const ENDPOINT_REGISTRY = "https://gist.githubusercontent.com/Katster12/12eee12c1e477a9120d8808ff6f03e64/raw/endpoint.json";
const FALLBACK_ML_API_URL = "https://mitsubishi-prospects-answers-poultry.trycloudflare.com";
let cachedEndpoint = "";
let endpointExpiresAt = 0;

async function resolveMlApiUrl(force = false) {
  if (process.env.ML_API_URL) return process.env.ML_API_URL.replace(/\/$/, "");
  if (!force && cachedEndpoint && Date.now() < endpointExpiresAt) return cachedEndpoint;
  try {
    const cacheKey = force ? Date.now() : Math.floor(Date.now() / 60000);
    const response = await fetch(`${ENDPOINT_REGISTRY}?refresh=${cacheKey}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`endpoint registry returned ${response.status}`);
    const data = await response.json();
    cachedEndpoint = String(data.url).replace(/\/$/, "");
    endpointExpiresAt = Date.now() + 60_000;
    return cachedEndpoint;
  } catch {
    return FALLBACK_ML_API_URL;
  }
}

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
    const requestUpstream = (baseUrl) => fetch(`${baseUrl}/api/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coin, horizons: req.body?.horizons }),
        signal: controller.signal,
      });
    let mlApiUrl = await resolveMlApiUrl();
    let upstream = await requestUpstream(mlApiUrl);
    if ([502, 503, 530].includes(upstream.status) && !process.env.ML_API_URL) {
      const refreshedUrl = await resolveMlApiUrl(true);
      if (refreshedUrl !== mlApiUrl) {
        mlApiUrl = refreshedUrl;
        upstream = await requestUpstream(mlApiUrl);
      }
    }
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
