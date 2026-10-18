import postgres from 'postgres';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
if(process.env.RANEEN_APPLY_SCHEMA==='1'){
const sql=postgres(process.env.POSTGRES_URL,{max:1,connect_timeout:20});
try {
await sql`create table if not exists public.field_schema_migrations(name text primary key,applied_at timestamptz default now())`;
await sql`alter table public.field_schema_migrations enable row level security`;
await sql`create schema if not exists supabase_migrations`;
await sql`create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text)`;
for(const name of (await readdir('supabase/migrations')).sort()){
if((await sql`select 1 from public.field_schema_migrations where name=${name}`).length)continue;
const source=await readFile('supabase/migrations/'+name,'utf8');
await sql.begin(async tx=>{await tx.unsafe(source);await tx`insert into public.field_schema_migrations(name) values(${name})`;await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${name.split('_')[0]},${name.replace(/^\d+_|\.sql$/g,'')},${[source]}) on conflict(version) do nothing`;});
console.log('Applied schema:',name);
}
const accounts=JSON.parse(process.env.RANEEN_INITIAL_MEMBERS||'[]');
for(const account of accounts){if(account.role==='outsider')continue;await sql`insert into public.field_members(user_id,display_name,role,force_password) values(${account.id},${account.name},${account.role},${!account.fixture}) on conflict(user_id) do nothing`;}
for(const id of JSON.parse(process.env.RANEEN_CLEANUP_FIXTURES||'[]')){await sql`delete from field_private.history h where actor=${id}::uuid and not exists(select 1 from public.field_sites s where s.id=h.site_id)`;await sql`delete from field_private.operations o where user_id=${id}::uuid and not exists(select 1 from public.field_sites s where s.id=o.site_id)`;}
const insecure=await sql`select c.relname from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='public' and c.relname like 'field_%' and c.relkind='r' and not c.relrowsecurity`;
if(insecure.length)throw Error('Missing RLS');
for(const name of (await readdir('supabase/migrations')).sort()){await sql`insert into supabase_migrations.schema_migrations(version,name,statements) values(${name.split('_')[0]},${name.replace(/^\d+_|\.sql$/g,'')},${[await readFile('supabase/migrations/'+name,'utf8')]}) on conflict(version) do nothing`;}
if(process.env.RANEEN_RUN_ADVISORS==='1'){const output=execFileSync('npx',['--yes','supabase@2.121.0','db','advisors','--db-url',process.env.POSTGRES_URL,'--type','security','--level','warn','--fail-on','error'],{timeout:120000,encoding:'utf8',env:{...process.env}});console.log(output);}
console.log('Schema verified; all field tables have RLS.');
}catch(e){console.error('Provisioning failed:',e.code||'ERROR');process.exitCode=1;}finally{await sql.end({timeout:2});}
}
