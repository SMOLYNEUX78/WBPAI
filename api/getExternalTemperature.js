// routes/externalTemperature.js
import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

router.get('/', async (req, res) => {
  const { lat, lon } = req.query;
  const apiKey = process.env.OWM_API_KEY;

  if (!lat || !lon) {
    return res.status(400).json({ error: "Latitude and longitude are required" });
  }

  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`
    );
    const data = await response.json();

    if (data.main && data.main.temp !== undefined) {
      res.json({ externalTemperature: data.main.temp });
    } else {
      res.status(500).json({ error: "Could not retrieve temperature" });
    }
  } catch (err) {
    console.error("Error fetching weather data:", err);
    res.status(500).json({ error: "Error fetching weather data" });
  }
});

export default router;

