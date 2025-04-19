const axios = require('axios');
require('dotenv').config();

const username = process.env.BRIGHT_USERNAME;
const password = process.env.BRIGHT_PASSWORD;

async function getDevices() {
  try {
    console.log(`🔐 Logging in with: ${username}`);

    // Step 1: Login
    const loginRes = await axios.post(
      'https://api.glowmarkt.com/api/login-user',
      { username, password },
      {
        headers: {
          'applicationId': 'bright_app',
          'Content-Type': 'application/json'
        }
      }
    );

    const token = loginRes.data.token;
    console.log('✅ Login successful. Token received:', token.slice(0, 12) + '...');

    // Step 2: Get devices
 const deviceUrl = 'https://api.glowmarkt.com/api/v1/device';
    console.log(`📡 Fetching devices from: ${deviceUrl}`);

    const deviceRes = await axios.get(deviceUrl, {
      headers: {
        'applicationId': 'bright_app',
        'Authorization': `Bearer ${token}`,
      }
    });

    console.log('📦 Devices retrieved successfully:');
    console.log(JSON.stringify(deviceRes.data, null, 2));
  } catch (error) {
    if (error.response) {
      console.error('❌ API responded with error:');
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('❌ Error:', error.message);
    }
  }
}

getDevices();

