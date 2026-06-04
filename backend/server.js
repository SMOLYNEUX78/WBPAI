const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// =====================================
// SUPABASE
// =====================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const BUILDING_ID = process.env.BUILDING_ID || "";

const withBuildingId = (payload) => {
  if (!BUILDING_ID) {
    return payload;
  }

  return {
    ...payload,
    building_id: BUILDING_ID,
  };
};

// =====================================
// WEATHER FETCH
// =====================================

const updateExternalTemperature = async () => {
  const lat = process.env.DEFAULT_LAT;
  const lon = process.env.DEFAULT_LON;

  if (!lat || !lon) {
    console.error(
      '❌ Missing DEFAULT_LAT or DEFAULT_LON in .env'
    );
    return;
  }

  try {
    const apiKey = process.env.WBP;

    const response = await axios.get(
      'https://api.openweathermap.org/data/2.5/weather',
      {
        params: {
          lat,
          lon,
          units: 'metric',
          appid: apiKey,
        },
      }
    );

    const externalTemp =
      response.data.main.temp;

    const { error } = await supabase
      .from('Readings')
      .insert([
        withBuildingId({
          temperature_outside:
            externalTemp,

          timestamp:
            new Date().toISOString(),
        }),
      ]);

    if (error) {
      console.error(
        '❌ Supabase weather insert error:',
        error.message
      );
    } else {
      console.log(
        `🌤 External temperature inserted: ${externalTemp}°C`
      );
    }
  } catch (err) {
    console.error(
      '❌ Weather fetch failed:',
      err.message
    );
  }
};

// Run weather update every 5 mins
setInterval(
  updateExternalTemperature,
  5 * 60 * 1000
);

// =====================================
// SAVE IAQ DATA
// =====================================

app.post(
  '/api/saveIAQ',
  async (req, res) => {
    try {
      const {
        temperature_inside,
        humidity,
        co2,
        voc_level,
        pm25_level,
      } = req.body;

      const payload = withBuildingId({
        temperature_inside,
        humidity,
        co2,
        voc_level,
        pm25_level,
        timestamp:
          new Date().toISOString(),
      });

      console.log(
        '📡 Incoming IAQ payload:',
        payload
      );

      const { error } = await supabase
        .from('Readings')
        .insert([payload]);

      if (error) {
        console.error(
          '❌ Supabase IAQ insert error:',
          error.message
        );

        return res.status(500).json({
          error: error.message,
        });
      }

      console.log(
        '✅ IAQ inserted into Supabase'
      );

      res.json({
        success: true,
      });
    } catch (err) {
      console.error(
        '❌ saveIAQ route failed:',
        err.message
      );

      res.status(500).json({
        error: err.message,
      });
    }
  }
);

// =====================================
// EXTERNAL TEMP ROUTE
// =====================================

app.get(
  '/api/getExternalTemperature',
  async (req, res) => {
    const { lat, lon } = req.query;

    if (!lat || !lon) {
      return res.status(400).json({
        error:
          'Missing lat or lon parameters',
      });
    }

    try {
      const apiKey = process.env.WBP;

      const response = await axios.get(
        'https://api.openweathermap.org/data/2.5/weather',
        {
          params: {
            lat,
            lon,
            units: 'metric',
            appid: apiKey,
          },
        }
      );

      const externalTemp =
        response.data.main.temp;

      res.json({
        externalTemperature:
          externalTemp,
      });
    } catch (error) {
      console.error(
        '❌ Failed to fetch external temp:',
        error.message
      );

      res.status(500).json({
        error:
          'Failed to fetch external temperature',
      });
    }
  }
);

// =====================================
// TEST ROUTE
// =====================================

app.get(
  '/api/pushTestTemperature',
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from('Readings')
          .insert([
            withBuildingId({
              temperature_outside: 12.3,

              timestamp:
                new Date().toISOString(),
            }),
          ]);

      if (error) {
        console.error(
          '❌ Supabase test insert error:',
          error.message
        );

        return res.status(500).json({
          error: error.message,
        });
      }

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        '❌ Test route error:',
        error.message
      );

      res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
);

// =====================================
// START SERVER
// =====================================

const port = 5000;

app.listen(port, () => {
  console.log(
    `🚀 Server running on port ${port}`
  );

  // Run weather fetch immediately
  updateExternalTemperature();
});
