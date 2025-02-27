const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const getSensorData = () => {
    const temperature = (20 + Math.random() * 5).toFixed(2);
    const humidity = (40 + Math.random() * 10).toFixed(2);
    const co2 = (300 + Math.random() * 50).toFixed(2);
    const occupancy = Math.floor(Math.random() * 100);
    const energyConsumption = (Math.random() * 50).toFixed(2);
    const efficiency = (temperature >= 21 && temperature <= 24 && humidity >= 45 && humidity <= 55 && co2 <= 400) ? 'High' : 'Moderate';
    const health = (co2 < 350 && humidity >= 40 && humidity <= 60) ? 'Good' : 'Poor';
    const carbonFootprint = (energyConsumption * 0.4).toFixed(2);

    return { temperature, humidity, co2, occupancy, energyConsumption, efficiency, health, carbonFootprint };
};

app.get('/api/sensors', (req, res) => {
    res.json(getSensorData());
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
