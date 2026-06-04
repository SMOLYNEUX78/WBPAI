const axios = require('axios');
require('dotenv').config();

const username = process.env.BRIGHT_USERNAME || process.env.MQTT_USERNAME;
const password = process.env.BRIGHT_PASSWORD || process.env.MQTT_PASSWORD;
const applicationId =
  process.env.GLOW_APPLICATION_ID || 'b0f1b774-a586-4f72-9edd-27ead8aa7a8d';
const apiBaseUrl = 'https://api.glowmarkt.com/api/v0-1';

async function getDevices() {
  try {
    console.log(`Logging in with: ${username}`);

    const loginRes = await axios.post(
      `${apiBaseUrl}/auth`,
      { username, password },
      {
        headers: {
          applicationId,
          'Content-Type': 'application/json',
        },
      }
    );

    const token = loginRes.data.token;
    console.log('Login successful. Token received.');

    const headers = {
      applicationId,
      token,
    };

    const [resourceRes, deviceRes] = await Promise.all([
      axios.get(`${apiBaseUrl}/resource`, { headers }),
      axios.get(`${apiBaseUrl}/device`, { headers }),
    ]);

    const devices = deviceRes.data.map((device) => ({
      hardwareId: device.hardwareId,
      parentHardwareId: device.parentHardwareId,
      tags: device.tags,
      sensors: (device.protocol?.sensors || []).map((sensor) => ({
        protocolId: sensor.protocolId,
        resourceId: sensor.resourceId,
      })),
    }));

    const resources = resourceRes.data.map((resource) => ({
      name: resource.name,
      classifier: resource.classifier,
      type: resource.dataSourceResourceTypeInfo?.type,
      unit: resource.baseUnit || resource.dataSourceResourceTypeInfo?.unit,
      resourceId: resource.resourceId,
      updatedAt: resource.updatedAt,
    }));

    console.log('Devices retrieved successfully:');
    console.log(JSON.stringify({ devices, resources }, null, 2));
  } catch (error) {
    if (error.response) {
      console.error('API responded with error:');
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

getDevices();
