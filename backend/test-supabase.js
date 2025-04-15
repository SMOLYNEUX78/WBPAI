const supabase = require('./supabaseClient');

async function testInsert() {
  const payload = {
    timestamp: new Date().toISOString(),
    energy_usage: 123.45,
    temperature_inside: 21.5,
    temperature_outside: 17.3,
    humidity: 48.2,
    voc_level: 0.4,
    pm25_level: 15
  };

  const { data, error } = await supabase
    .from('Readings') // Case-sensitive table name
    .insert([payload]);

  if (error) {
    console.error('❌ Supabase insert error:', JSON.stringify(error, null, 2));
  } else {
    console.log('✅ Data saved to Supabase:', data);
  }
}

testInsert();

