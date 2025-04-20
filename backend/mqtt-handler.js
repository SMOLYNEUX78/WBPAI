require('dotenv').config();
const mqtt = require('mqtt');
const supabase = require('./supabaseClient');
const fs = require('fs');

// ===== Debug: Check environment and dependency =====
console.log('📂 Current dir:', process.cwd());
console.log('📄 .env URL:', process.env.SUPABASE_URL);
try {
  require.resolve('@supabase/supabase-js');
  console.log('✅ supabase-js is installed');
} catch {
  console.error('❌ supabase-js is NOT installed!');
}

// ===== MQTT connection options =====
const options = {
  clientId: `mqtt_${Math.random().toString(16).slice(3)}`,
  keepalive: 60,
  clean: true,
};

// ===== Connect to local Mosquitto broker =====
const client = mqtt.connect('mqtt://localhost:1883', options);

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

    // Match your CAD topic shape
    if (topic.includes('SENSOR/electricitymeter')) {
      const powerValue = payload?.power?.value;

      if (typeof powerValue === 'number') {
        const energyUsage = powerValue / 1000; // Convert to kW
        const timestamp = new Date().toISOString();

        const { data, error } = await supabase
          .from('Readings')
          .insert([{ timestamp, energy_usage: energyUsage }]);

        if (error) {
          console.error('❌ Supabase insert error:', error);
        } else {
          console.log(`✅ Logged to Supabase: ${energyUsage} kW @ ${timestamp}`);
        }
      } else {
        console.warn('⚠️ power.value missing or invalid:', payload);
      }
    } else {
      console.log('🔍 Ignored topic (not SENSOR/electricitymeter)');
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

