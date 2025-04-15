const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://test.mosquitto.org:1883');

client.on('connect', () => {
  console.log('🟢 Publisher connected to MQTT broker');

  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    energy_usage: 1.4,
    temperature_inside: 22.5,
    temperature_outside: 11.0,
    humidity: 47.2,
    voc_level: 0.4,
    pm25_level: 13
  });

  client.publish('test/wbpai/demo', payload, () => {
    console.log('📤 Test payload published to MQTT topic!');
    client.end();
  });
});

