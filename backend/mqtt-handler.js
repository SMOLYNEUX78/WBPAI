const mqtt = require('mqtt');
const supabase = require('./supabaseClient');
require('dotenv').config();

const options = {
  username: process.env.BRIGHT_USERNAME,
  password: process.env.BRIGHT_PASSWORD,
  clientId: `mqtt_${Math.random().toString(16).slice(3)}`,
  keepalive: 60,
  clean: true,
};

const client = mqtt.connect('mqtts://glowmqtt.energyhive.com:8883', options);

client.on('connect', () => {
  console.log('✅ Connected to Glowmarkt MQTT broker');

  const topic = 'device/DEVICE_ID/reading'; // We'll replace DEVICE_ID in a sec
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
    const payload = JSON.parse(message.toString());
    console.log('📥 Incoming MQTT payload:', payload);

    const { data, error } = await supabase
      .from('Readings')
      .insert([{
        timestamp: new Date().toISOString(),
        energy_usage: payload.data?.[0] || 0, // Adjust as needed
      }]);

    if (error) {
      console.error('❌ Supabase insert error:', error);
    } else {
      console.log('✅ Data saved to Supabase:', data);
    }
  } catch (err) {
    console.error('❌ Failed to handle message:', err.message);
  }
});

