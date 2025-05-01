const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
const port = 5000;

require("dotenv").config();

// Use CORS to allow cross-origin requests
app.use(cors());

// Handle the external temperature route directly here
app.get('/api/getExternalTemperature', async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: "Missing lat or lon parameters" });
  }

  try {
    const apiKey = process.env.WBP; // OpenWeatherMap API key
    const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: {
        lat,
        lon,
        units: 'metric',
        appid: apiKey,
      }
    });
    console.log("API Key:", process.env.WBP);

    const externalTemp = response.data.main.temp;
    res.json({ externalTemperature: externalTemp });
  } catch (error) {
    console.error("Failed to fetch external temp:", error.message);
    res.status(500).json({ error: "Failed to fetch external temperature" });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

