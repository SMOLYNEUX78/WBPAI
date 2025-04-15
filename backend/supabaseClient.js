import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://your-project.supabase.co'; // replace with your actual URL
const supabaseAnonKey = 'your-anon-key'; // replace with your actual anon key

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

