const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://test.mosquitto.org:1883');

client.on('connect', () => {
  console.log('✅ Connected to Mosquitto test broker');
  client.end();
});

client.on('error', (err) => {
  console.error('❌ Connection error:', err.message);
});

