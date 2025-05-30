const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());

const updateExternalTemperature = async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const lat = process.env.DEFAULT_LAT;
  const lon = process.env.DEFAULT_LON;

  if (!lat || !lon) {
    console.error("Missing DEFAULT_LAT or DEFAULT_LON in .env");
    return;
  }

  try {
    const apiKey = process.env.WBP;
    const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: { lat, lon, units: 'metric', appid: apiKey }
    });

    const externalTemp = response.data.main.temp;

    const { data, error } = await supabase
      .from('Readings')
      .insert([
        {
          temperature_outside: externalTemp,
          timestamp: new Date().toISOString(), // Optional, depending on Supabase config
          // You can include device_id, room_id, etc. if needed
        }
      ]);

    if (error) {
      console.error('Supabase error during insert:', error.message);
    } else {
      console.log(`✔ Inserted external temp: ${externalTemp}°C`);
    }
  } catch (err) {
    console.error("Auto-fetch failed:", err.message);
  }
};

// 🔁 Run every 5 minutes
setInterval(updateExternalTemperature, 5 * 60 * 1000);

// 🔗 Existing API routes
app.get('/api/getExternalTemperature', async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: "Missing lat or lon parameters" });
  }

  try {
    const apiKey = process.env.WBP;
    const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: { lat, lon, units: 'metric', appid: apiKey }
    });

    const externalTemp = response.data.main.temp;
    res.json({ externalTemperature: externalTemp });
  } catch (error) {
    console.error("Failed to fetch external temp:", error.message);
    res.status(500).json({ error: "Failed to fetch external temperature" });
  }
});

app.get('/api/pushTestTemperature', async (req, res) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  try {
    const { data, error } = await supabase
      .from('Readings')
      .insert([
        {
          temperature_outside: 12.3,
          timestamp: new Date().toISOString(), // Optional
        }
      ]);

    if (error) {
      console.error('Supabase error in test insert:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error in pushTestTemperature:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
const port = 5000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  updateExternalTemperature(); // Run once on start
});

