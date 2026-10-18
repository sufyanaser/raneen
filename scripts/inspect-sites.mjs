import fs from 'node:fs';
import postgres from 'postgres';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const sql = postgres(env.POSTGRES_URL, { max: 1 });

const tables = await sql`select table_name from information_schema.tables where table_schema = 'public'`;
console.log('Public tables:', tables.map(t => t.table_name));

const s5803 = await sql`select * from public.field_sites where data::text like '%5803%' or id::text like '%5803%'`;
console.log('field_sites matching 5803:', s5803.length);

const st5803 = await sql`select * from storage.objects where name like '%5803%' or id::text like '%5803%'`;
console.log('storage.objects matching 5803:', st5803.length);

const mb5803 = await sql`select * from public.field_members where user_id::text like '%5803%' or display_name like '%5803%'`;
console.log('field_members matching 5803:', mb5803.length);

// Also check all sites IDs
const allSites = await sql`select id, data->>'name' as name, data->>'street' as street, jsonb_array_length(case when jsonb_typeof(data->'photos') = 'array' then data->'photos' else '[]'::jsonb end) as photos_count from public.field_sites`;
console.log('All sites in DB:');
for (const s of allSites) {
  console.log(`- ${s.id} | "${s.name || ''}" | "${s.street || ''}" | photos: ${s.photos_count}`);
}

await sql.end();
