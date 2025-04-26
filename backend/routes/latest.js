const express = require('express');
const router = express.Router();
const { supabase } = require('../supabaseClient');

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('readings')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1);

    if (error) throw error;

    res.json(data[0] || {});
  } catch (err) {
    console.error('Error fetching latest data:', err.message);
    res.status(500).json({ error: 'Error fetching latest data' });
  }
});

module.exports = router;

