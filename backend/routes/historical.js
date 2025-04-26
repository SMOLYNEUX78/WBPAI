const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

router.get('/', async (req, res) => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const { data, error } = await supabase
    .from('Readings')
    .select('energy_usage, timestamp')
    .gte('timestamp', yesterday.toISOString());

  if (error) {
    console.error('Error fetching historical data:', error);
    return res.status(500).json({ error: 'Failed to fetch historical data' });
  }

  let total = 0;
  let count = 0;

  data.forEach(reading => {
    total += reading.energy_usage;
    count += 1;
  });

  const averagePerformance = count > 0 ? total / count : 0;

  res.json({ averagePerformance });
});

module.exports = router;

