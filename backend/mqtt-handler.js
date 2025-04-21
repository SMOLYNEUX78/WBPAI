// mqtt-handler.js

const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = mqtt.connect('mqtt://localhost'); // adjust if needed

client.on('connect', () => {
  console.log(`[${new Date().toISOString()}] Connected to MQTT broker.`);
  client.subscribe('glow/#', (err) => {
    if (err) {
      console.error('Subscription error:', err);
    } else {
      console.log('Subscribed to glow/#');
    }
  });
});

client.on('message', async (topic, message) => {
  const timestamp = new Date().toISOString();
  console.debug(`[${timestamp}] Received topic: ${topic}`);

  let payload;
  try {
    payload = JSON.parse(message.toString());
  } catch (err) {
    console.error(`[${timestamp}] Failed to parse message:`, message.toString());
    return;
  }

  let powerValue = null;

  if (payload?.electricitymeter?.power?.value) {
    powerValue = payload.electricitymeter.power.value;
  } else if (Array.isArray(payload?.data) && payload.data.length > 0) {
    powerValue = payload.data[0];
  }

  if (typeof powerValue === 'number') {
    const kWh = powerValue / 1000;
    const { data, error } = await supabase
      .from('Readings')
      .insert([{ timestamp, energy_usage: kWh }]);

    if (error) {
      console.error(`[${timestamp}] ❌ Supabase insert error:`, error.message);
    } else {
      console.log(`[${timestamp}] ✅ Logged ${kWh} kWh to Supabase`);
    }
  } else {
    console.warn(`[${timestamp}] ⚠️ power value missing or invalid`);
  }
});

client.on('error', (err) => {
  console.error('❌ MQTT client error:', err);
});

client.on('offline', () => {
  console.warn('⚠️ MQTT client went offline');
});

client.on('reconnect', () => {
  console.log('🔄 Reconnecting to MQTT broker...');
});

