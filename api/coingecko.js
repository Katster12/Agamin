// Vercel Serverless Function – proxy for ALL CoinGecko API requests.
// This avoids CORS issues since the request is made server-side.

const CG_BASE = "https://api.coingecko.com/api/v3";
const CG_API_KEY = process.env.CG_API_KEY || "CG-XgRkwptpUH4LFa6Mub8chHXH";

export default async function handler(req, res) {
  // Allow any origin (Vercel frontend will call this)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET allowed" });
  }

  try {
    // The "path" query param carries the CoinGecko sub-path, e.g. "/coins/markets"
    const { path, ...queryParams } = req.query;

    if (!path) {
      return res.status(400).json({ error: "Missing 'path' query parameter" });
    }

    // Rebuild the query string (excluding our custom "path" key)
    const qs = new URLSearchParams(queryParams).toString();
    const url = `${CG_BASE}${path}${qs ? `?${qs}` : ""}`;

    const upstream = await fetch(url, {
      headers: {
        "x-cg-demo-api-key": CG_API_KEY,
        Accept: "application/json",
      },
    });

    // Forward rate-limit / error status from CoinGecko
    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({
        error: `CoinGecko returned ${upstream.status}`,
        detail: text,
      });
    }

    const data = await upstream.json();

    // Cache for 30 seconds at the edge to reduce upstream hits
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json(data);
  } catch (error) {
    console.error("CoinGecko proxy error:", error);
    return res.status(500).json({ error: error.message });
  }
}
