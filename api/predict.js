export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      message: "Only POST allowed"
    });
  }

  try {

    // CURRENT TEMPORARY RESPONSE
    // REMOVE THIS LATER
    return res.status(200).json({
      success: true,
      coin: req.body.coin,
      prediction: "Bullish",
      confidence: 78,
      price_target: 108500
    });




    /*
    ============================
    LATER AWS WEBHOOK CALL HERE
    ============================

    const response = await fetch(process.env.AWS_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.AWS_API_KEY
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    return res.status(200).json(data);

    */

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: error.message
    });

  }
}