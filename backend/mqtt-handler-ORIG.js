const mqtt = require('mqtt');
const supabase = require('./supabaseClient');
require('dotenv').config();
const fs = require('fs');

// Diagnostics
console.log('📂 Current dir:', process.cwd());
console.log('📄 .env URL:', process.env.SUPABASE_URL);
try {
  require.resolve('@supabase/supabase-js');
  console.log('✅ supabase-js is installed');
} catch {
  console.error('❌ supabase-js is NOT installed!');
}

// MQTT options
const options = {
  clientId: `mqtt_${Math.random().toString(16).slice(3)}`,
  keepalive: 60,
  clean: true,
};

const client = mqtt.connect('mqtt://localhost:1883', options); // Local Mosquitto broker

client.on('connect', () => {
  console.log('✅ Connected to local Mosquitto broker');

  const topic = 'glow/#';
  client.subscribe(topic, (err) => {
    if (err) {
      console.error('❌ Subscription error:', err);
    } else {
      console.log(`📡 Subscribed to topic: ${topic}`);
    }
  });
});

client.on('message', async (topic, message) => {
  try {
    const payloadStr = message.toString();
    const payload = JSON.parse(payloadStr);

    console.log(`📬 Topic: ${topic}`);
    console.log(`📦 Raw Payload:`, payload);

    // Look for electricity meter readings in glow topic
    if (topic.includes('glow') && topic.includes('electricitymeter')) {
      const powerValue = Array.isArray(payload?.data) ? payload.data[0] : null;

      if (typeof powerValue === 'number') {
        const timestamp = new Date().toISOString();

        const { data, error } = await supabase
          .from('Readings')
          .insert([{ timestamp, energy_usage: powerValue / 1000 }]); // watts to kWh

        if (error) {
          console.error('❌ Supabase insert error:', error);
        } else {
          console.log(`✅ Logged to Supabase: ${powerValue} W @ ${timestamp}`);
        }
      } else {
        console.warn('⚠️ Payload received but data[0] is missing or not a number:', payload);
      }
    } else {
      console.log('🔍 Ignored topic:', topic);
    }
  } catch (err) {
    console.error('❌ Failed to handle message:', err.message);
    console.error('🧪 Raw message:', message.toString());
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

