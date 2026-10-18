import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const envFile = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '';
const env = Object.fromEntries(
  envFile
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      const k = l.slice(0, i);
      let v = l.slice(i + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return [k, v];
    })
);

test('Supabase environment variables and endpoint accessibility', async () => {
  assert.ok(env.VITE_PUBLIC_SUPABASE_URL, 'VITE_PUBLIC_SUPABASE_URL must be defined');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY must be defined');

  const adminClient = createClient(env.VITE_PUBLIC_SUPABASE_URL, serviceKey);
  const { data: members, error } = await adminClient.from('field_members').select('user_id, display_name, role, active');
  assert.equal(error, null, 'Fetching field_members with service role should succeed');
  assert.ok(Array.isArray(members), 'Members should be an array');
  assert.ok(members.length > 0, 'Should have registered members');

  const adminMember = members.find(m => m.role === 'admin');
  assert.ok(adminMember, 'At least one supervisor (admin) member must be present');
  assert.equal(adminMember.display_name, 'Sufyan');

  const { data: sites, error: sitesError } = await adminClient.from('field_sites').select('id, version, created_name').limit(5);
  assert.equal(sitesError, null, 'Fetching field_sites should succeed');
  assert.ok(Array.isArray(sites), 'Sites should be an array');
});
