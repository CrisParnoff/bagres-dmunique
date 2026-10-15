import worker from '../dist/server/index.js';
import { createSupabaseEnv } from './supabase.mjs';

export async function handleVercelRequest(request, config = process.env, fetcher = fetch) {
  const url = new URL(request.url);
  // Vercel rewrites the existing public photo URL into the API catch-all.
  if (url.pathname.startsWith('/api/player-photos/')) url.pathname = url.pathname.slice(4);
  const headers = new Headers(request.headers);
  headers.delete('CF-Connecting-IP');
  headers.set('CF-Connecting-IP', request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() || 'unknown');
  const method = request.method;
  try {
    // Public data remains readable while the owner finishes admin setup.
    // Writes still require a valid signed session in the existing worker.
    if (url.pathname === '/api/admin/login' && (!config.ADMIN_PASSWORD_HASH || !config.ADMIN_SESSION_KEY)) {
      return new Response(JSON.stringify({error:'Administração ainda não configurada. Configure as credenciais de admin na Vercel.'}), {status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    const body = ['GET','HEAD'].includes(method) ? undefined : await request.arrayBuffer();
    if (body && body.byteLength > 3 * 1024 * 1024) return new Response(JSON.stringify({error:'Dados muito grandes'}), {status:413,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    const forwarded = new Request(url, {method,headers,body});
    return await worker.fetch(forwarded, createSupabaseEnv(config,fetcher));
  } catch (error) {
    // Never print service credentials or upstream response bodies.
    console.error('Bagres API unavailable:', error.message);
    return new Response(JSON.stringify({error:'Servidor indisponível. Verifique a configuração do banco.'}), {status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
}
