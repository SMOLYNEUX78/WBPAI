const axios = require('axios');
require('dotenv').config();

const username = process.env.BRIGHT_USERNAME;
const password = process.env.BRIGHT_PASSWORD;

async function getDevices() {
  try {
    // Step 1: Authenticate and get token
    const authRes = await axios.post('https://api.glowmarkt.com/api/v0-1/login-user', {
      username,
      password
    }, {
      headers: {
        'applicationId': 'bright_app',
        'Content-Type': 'application/json'
      }
    });

    const token = authRes.data.token;
    console.log('✅ Logged in, got token');

    // Step 2: Use token to get list of devices
    const devicesRes = await axios.get('https://api.glowmarkt.com/api/v0-1/device', {
      headers: {
        'applicationId': 'bright_app',
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('📦 Devices:', JSON.stringify(devicesRes.data, null, 2));
  } catch (error) {
    console.error('❌ Error fetching devices:', error.response?.data || error.message);
  }
}

getDevices();

