// Supabase Storage + Postgres adapter.
// Server-side only: SUPABASE_SERVICE_ROLE_KEY must never be exposed to the browser.

function config(){
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'inova-vision';
  return { url, key, bucket };
}

export function hasSupabaseCredentials(){
  const {url,key} = config();
  return Boolean(url && key);
}

export function getSupabaseInfo(){
  const {url,key,bucket} = config();
  return {
    configured: Boolean(url && key),
    urlConfigured: Boolean(url),
    serviceRoleConfigured: Boolean(key),
    bucket
  };
}

function headers(extra={}){
  const {key} = config();
  return { Authorization:`Bearer ${key}`, apikey:key, ...extra };
}

let bucketReady = null;

async function ensureResponseOk(res, label){
  if(res.ok) return;
  const text = await res.text().catch(()=>"");
  throw new Error(`${label} HTTP ${res.status}: ${text.slice(0,700)}`);
}

export function supabasePublicUrl(pathname){
  const {url,bucket} = config();
  if(!url || !pathname) return null;
  return `${url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${String(pathname).split('/').map(encodeURIComponent).join('/')}`;
}

export async function ensureStorageBucket(){
  if(bucketReady) return bucketReady;
  bucketReady = (async()=>{
    const {url,key,bucket} = config();
    if(!url || !key) throw new Error('Supabase belum dikonfigurasi. Tambahkan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di Vercel.');
    const res = await fetch(`${url}/storage/v1/bucket`, {
      method:'POST',
      headers:headers({'Content-Type':'application/json'}),
      body:JSON.stringify({id:bucket,name:bucket,public:true,file_size_limit:50*1024*1024})
    });
    if(res.ok) return true;
    const text = await res.text().catch(()=>"");
    if(/already exists|duplicate|Bucket already exists/i.test(text)){
      // Keep an existing bucket public because Magic Hour and the browser need
      // a fetchable URL. If it is already public this is a harmless no-op.
      const update = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
        method:'PUT', headers:headers({'Content-Type':'application/json'}), body:JSON.stringify({public:true})
      });
      if(!update.ok){
        const updateText=await update.text().catch(()=>"");
        throw new Error(`Supabase bucket harus Public. Gagal mengubah bucket HTTP ${update.status}: ${updateText.slice(0,500)}`);
      }
      return true;
    }
    throw new Error(`Supabase Storage bucket gagal dibuat HTTP ${res.status}: ${text.slice(0,500)}`);
  })().catch(error=>{bucketReady=null;throw error;});
  return bucketReady;
}

export async function uploadStorage(pathname, data, contentType){
  const {url,bucket} = config();
  if(!hasSupabaseCredentials()) throw new Error('Supabase belum dikonfigurasi. Tambahkan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di Vercel.');
  await ensureStorageBucket();
  const cleanPath = String(pathname).replace(/^\/+/, '');
  const res = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${cleanPath.split('/').map(encodeURIComponent).join('/')}`, {
    method:'POST',
    headers:headers({'Content-Type':contentType || 'application/octet-stream','x-upsert':'true','cache-control':'31536000'}),
    body:data
  });
  await ensureResponseOk(res,'Supabase Storage upload gagal');
  return { url:supabasePublicUrl(cleanPath), pathname:cleanPath, contentType:contentType || 'application/octet-stream' };
}

export async function downloadStorage(pathname){
  const {url,bucket} = config();
  if(!hasSupabaseCredentials()) throw new Error('Supabase belum dikonfigurasi.');
  const cleanPath = String(pathname).replace(/^\/+/, '');
  const res = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${cleanPath.split('/').map(encodeURIComponent).join('/')}`, { headers:headers() });
  if(res.status===404) return null;
  await ensureResponseOk(res,'Supabase Storage download gagal');
  return await res.arrayBuffer();
}

export async function saveJobRecord(job){
  const {url} = config();
  if(!hasSupabaseCredentials()) throw new Error('Supabase belum dikonfigurasi.');
  const res = await fetch(`${url}/rest/v1/inova_jobs?on_conflict=id`, {
    method:'POST',
    headers:headers({'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'}),
    body:JSON.stringify({id:job.id, job, updated_at:job.updatedAt || new Date().toISOString()})
  });
  await ensureResponseOk(res,'Supabase Database save job gagal');
  return job;
}

export async function getJobRecord(id){
  const {url} = config();
  if(!hasSupabaseCredentials()) return null;
  const res = await fetch(`${url}/rest/v1/inova_jobs?select=job&id=eq.${encodeURIComponent(id)}&limit=1`, {headers:headers({'Accept':'application/json'})});
  if(res.status===404) return null;
  await ensureResponseOk(res,'Supabase Database read job gagal');
  const rows = await res.json().catch(()=>[]);
  return rows?.[0]?.job || null;
}
