// Import required libraries
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize the Express app
const app = express();

// Use CORS to allow cross-origin requests
app.use(cors());

// Define route for fetching external temperature
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

    const externalTemp = response.data.main.temp;
    res.json({ externalTemperature: externalTemp });
  } catch (error) {
    console.error("Failed to fetch external temp:", error.message);
    res.status(500).json({ error: "Failed to fetch external temperature" });
  }
});

// Define route for testing the temperature push to Supabase
app.get('/api/pushTestTemperature', async (req, res) => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );

  try {
    // Updating the most recent reading in the Readings table
    const { data, error } = await supabase
      .from('Readings')
      .update({ temperature_outside: 12.3 }) // Test value
      .order('timestamp', { ascending: false }) // Ensure we update the most recent record
      .limit(1)
      .select();

    if (error) {
      console.error('Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error in pushTestTemperature:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server on the specified port
const port = 5000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

