// supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.REACT_APP_SUPABASE_URL ||
  "https://hvtuvapshvhwfgnnhzbh.supabase.co";
const envSupabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabaseAnonKey =
  envSupabaseAnonKey && envSupabaseAnonKey.startsWith("eyJ")
    ? envSupabaseAnonKey
    : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Imh2dHV2YXBzaHZod2Znbm5oemJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ3MjM4NTMsImV4cCI6MjA2MDI5OTg1M30.rZzCXqkhf93-8o5EYylgaCWxyTxeMzsNvl1lEzeBSpY";

const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);

export default supabase;

