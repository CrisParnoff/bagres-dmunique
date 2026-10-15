// Server-only bridge: keep the existing football rules and D1/R2 interface.
export function createSupabaseEnv(config = process.env, fetcher = fetch) {
  const base = config.SUPABASE_URL?.replace(/\/$/, '');
  const secret = config.SUPABASE_SECRET_KEY || config.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !secret) throw new Error('Missing server configuration');
  if (!secret.startsWith('sb_secret_') && !secret.startsWith('eyJ')) throw new Error('A Supabase server secret key is required');
  const url = new URL(base);
  if (url.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS');
  const bucket = config.SUPABASE_STORAGE_BUCKET || 'bagres-player-photos';
  // New opaque secret keys authenticate through apikey, not as a JWT bearer.
  const headers = { apikey: secret, ...(secret.startsWith('eyJ') ? {Authorization:`Bearer ${secret}`} : {}) };
  async function call(path, options = {}, allowMissing = false) {
    const response = await fetcher(`${base}${path}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(15000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
    return response;
  }
  const rest = async (path, options) => {
    const response = await call(`/rest/v1/${path}`, options);
    return response.status === 204 ? null : response.json();
  };
  const jsonHeaders = { 'Content-Type': 'application/json' };
  const DB = {
    prepare(sql) {
      const statement = sql.replace(/\s+/g, ' ').trim();
      function bound(args) {
        return {
          bind: (...values) => bound(values),
          async first() {
            if (statement === 'SELECT data, version FROM site_state WHERE id = 1') return (await rest('site_state?id=eq.1&select=data,version'))[0] || null;
            if (statement === 'SELECT failures, locked_until FROM admin_attempts WHERE client_key = ?') return (await rest(`admin_attempts?client_key=eq.${encodeURIComponent(args[0])}&select=failures,locked_until`))[0] || null;
            throw new Error('Unsupported database read');
          },
          async run() {
            if (statement.startsWith('INSERT OR IGNORE INTO site_state ') || statement.startsWith('UPDATE site_state SET data = ?')) {
              const expected = statement.startsWith('INSERT') ? 0 : args[1];
              const version = await rest('rpc/save_site_state', { method:'POST', headers:jsonHeaders, body:JSON.stringify({p_data:args[0],p_expected_version:expected}) });
              return { meta: { changes: version > 0 ? 1 : 0 } };
            }
            if (statement.startsWith('INSERT INTO admin_attempts ')) {
              await rest('admin_attempts', { method:'POST', headers:{...jsonHeaders, Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify({client_key:args[0],failures:args[1],locked_until:args[2]}) });
              return { meta: { changes:1 } };
            }
            if (statement === 'DELETE FROM admin_attempts WHERE client_key = ?') {
              await rest(`admin_attempts?client_key=eq.${encodeURIComponent(args[0])}`, {method:'DELETE',headers:{Prefer:'return=minimal'}});
              return { meta: { changes:1 } };
            }
            throw new Error('Unsupported database write');
          }
        };
      }
      return bound([]);
    }
  };
  const objectPath = key => {
    if (!/^players\/[a-zA-Z0-9_-]{1,64}\/[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid photo key');
    return `${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  };
  const BUCKET = {
    async put(key, stream, metadata) {
      await call(`/storage/v1/object/${objectPath(key)}`, {method:'POST',headers:{'Content-Type':metadata.httpMetadata.contentType,'x-upsert':'false'},body:await new Response(stream).arrayBuffer()});
    },
    async get(key) {
      const response = await call(`/storage/v1/object/authenticated/${objectPath(key)}`, {}, true);
      if (!response) return null;
      const contentType=response.headers.get('Content-Type')?.split(';')[0];
      // Dashboard imports of extensionless R2 keys can retain a generic MIME.
      // Recover only recognized image signatures; never serve arbitrary binary.
      if (['application/octet-stream','binary/octet-stream'].includes(contentType)) {
        if (Number(response.headers.get('Content-Length')) > 2*1024*1024) return null;
        const bytes=new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 2*1024*1024) return null;
        const starts=(signature,offset=0)=>signature.every((byte,index)=>bytes[offset+index]===byte);
        const detected=starts([255,216,255]) ? 'image/jpeg'
          : starts([137,80,78,71,13,10,26,10]) ? 'image/png'
          : starts([82,73,70,70]) && starts([87,69,66,80],8) ? 'image/webp' : null;
        return detected ? {body:bytes,httpMetadata:{contentType:detected}} : null;
      }
      return {body:response.body,httpMetadata:{contentType}};
    },
    async delete(key) {
      objectPath(key);
      await call(`/storage/v1/object/${encodeURIComponent(bucket)}`, {method:'DELETE',headers:jsonHeaders,body:JSON.stringify({prefixes:[key]})});
    }
  };
  return {DB,BUCKET,ADMIN_PASSWORD_HASH:config.ADMIN_PASSWORD_HASH,ADMIN_SESSION_KEY:config.ADMIN_SESSION_KEY};
}
