const supabase = require('./supabaseClient'); // make sure this is at the top

(async () => {
  const { data, error } = await supabase.from('Readings').insert([
    {
      timestamp: new Date().toISOString(),
      energy_usage: 2.2,
      temperature_inside: 21,
      temperature_outside: 10,
      humidity: 50,
      voc_level: 0.3,
      pm25_level: 12
    }
  ]);

  if (error) {
    console.error('❌ Manual test insert failed:', JSON.stringify(error, null, 2));
  } else {
    console.log('✅ Manual test insert success:', data);
  }
})();

