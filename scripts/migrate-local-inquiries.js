const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const projectRoot = path.join(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const inquiriesPath = path.join(projectRoot, 'data', 'inquiries.json');

const loadEnvironment = () => {
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env file. Create it from .env.example first.');
  }

  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) return;

    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) process.env[match[1]] = value;
  });
};

const main = async () => {
  loadEnvironment();
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = process.env;

  if (!url || !serviceKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  }
  if (!fs.existsSync(inquiriesPath)) {
    throw new Error('No local inquiry file was found at data/inquiries.json.');
  }

  const inquiries = JSON.parse(fs.readFileSync(inquiriesPath, 'utf8'));
  if (!Array.isArray(inquiries)) {
    throw new Error('data/inquiries.json must contain a JSON array.');
  }
  if (inquiries.length === 0) {
    console.log('No local enquiries to migrate.');
    return;
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false }
  });
  const { error } = await supabase
    .from('inquiries')
    .upsert(inquiries, { onConflict: 'id' });

  if (error) throw new Error(`Supabase migration failed: ${error.message}`);
  console.log(`Migrated ${inquiries.length} local enquiries to Supabase.`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
