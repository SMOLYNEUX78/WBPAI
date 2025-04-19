const mqtt = require('mqtt');
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
  console.log('✅ Connected to MQTT broker');

  const topic = 'device/#';
  client.subscribe(topic, (err) => {
    if (err) {
      console.error('❌ Subscription error:', err);
    } else {
      console.log(`📡 Subscribed to topic: ${topic}`);
    }
  });
});

client.on('message', (topic, message) => {
  console.log('📥 MQTT Message Received!');
  console.log('🔸 Topic:', topic);
  console.log('📦 Payload:', message.toString());
});

client.on('error', (err) => {
  console.error('❌ MQTT Error:', err);
});

client.on('close', () => {
  console.log('🚪 Connection closed');
});

client.on('offline', () => {
  console.log('📴 Client went offline');
});

client.on('reconnect', () => {
  console.log('🔁 Reconnecting...');
});

