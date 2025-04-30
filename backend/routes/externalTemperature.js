const express = require('express');
const router = express.Router();
const axios = require('axios');
require('dotenv').config();

router.get('/', async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: "Missing lat or lon parameters" });
  }

  console.log("Fetching external temperature for:", lat, lon); // Log the coordinates

  try {
    const apiKey = process.env.WBP; // Assuming your .env uses WBP
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather`,
      {
        params: {
          lat,
          lon,
          units: 'metric',
          appid: apiKey,
        }
      }
    );

    console.log("API Response:", response.data); // Log the API response for debugging
    const externalTemp = response.data.main.temp;
    res.json({ externalTemperature: externalTemp });
  } catch (error) {
    console.error("Failed to fetch external temp:", error.message);
    res.status(500).json({ error: "Failed to fetch external temperature" });
  }
});

module.exports = router;

