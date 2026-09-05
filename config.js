// Supabase connection settings for the Family Tree app.
//
// Setup:
//   1. Create a free project at https://supabase.com
//   2. Open the SQL Editor and run the script in supabase-schema.sql
//   3. Go to Project Settings > API and copy the "Project URL" and the
//      "anon public" key
//   4. Paste them below and commit/push this file
//
// The anon key is meant to be public — it's safe to ship in client-side
// code. Access control comes from the Row Level Security policies defined
// in supabase-schema.sql, not from keeping this key secret.
//
// Leaving these blank runs the app in local-only mode (saves to this
// browser's localStorage instead of the shared database).
window.SUPABASE_CONFIG = {
  url: 'https://fjzrodjqysdaarfmxvqv.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqenJvZGpxeXNkYWFyZm14dnF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NTk0OTIsImV4cCI6MjEwNDEzNTQ5Mn0.XapBkqZOv8GRDiI9t0mJ4TA4bnfPQ3DblupwEJxjvko',
};
