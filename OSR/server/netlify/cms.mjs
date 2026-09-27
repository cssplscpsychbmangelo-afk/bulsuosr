import { connectLambda, getStore } from '@netlify/blobs';
import serverless from 'serverless-http';
import { createHash } from 'node:crypto';
import { createApp } from '../app.js';
import { getDatabase, allowLogin } from '../db/postgres.js';

const json = (statusCode, error) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify({ error }) });

export function createHandler({ database = getDatabase, mediaStore, checkLogin = allowLogin }) {
  return async (event, context) => {
    event = { ...event, path: event.path.replace(/^\/\.netlify\/functions\/cms(?=\/|$)/, '/api') };
    try {
      // Standalone mode: only DATABASE_URL is required (Neon). JWT_SECRET is
      // auto-generated and persisted in site_settings if missing.
      if (!process.env.DATABASE_URL) {
        return json(503, 'DATABASE_URL is missing. Set your Neon connection string in Netlify environment variables with Functions scope, then redeploy. Only DATABASE_URL is required — admin credentials live in Neon.');
      }
      const db = await database();

      // Ensure JWT_SECRET env is populated from DB for standalone sessions
      if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 16) {
        try {
          const row = await db.prepare('SELECT value FROM osr.site_settings WHERE key=$1').get('jwt_secret');
          if (row?.value) {
            process.env.JWT_SECRET = row.value;
          } else {
            const { randomBytes } = await import('node:crypto');
            const gen = randomBytes(48).toString('hex');
            await db.prepare('INSERT INTO osr.site_settings (key, value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value').run('jwt_secret', gen);
            process.env.JWT_SECRET = gen;
            console.log('[CMS] Generated and persisted jwt_secret (standalone)');
          }
        } catch (e) {
          console.warn('[CMS] Could not ensure jwt_secret:', e.message);
        }
      }

      if (event.path === '/api/auth/login' && event.httpMethod === 'POST') {
        const ip = event.headers?.['x-nf-client-connection-ip'] || event.requestContext?.identity?.sourceIp || 'unknown';
        const key = createHash('sha256').update(ip).digest('hex');
        if (!await checkLogin(db, key)) return json(429, 'Too many attempts, try again in 15 minutes.');
      }
      const app = createApp(db, { mediaStore: mediaStore() });
      const response = await serverless(app)(event, context);
      response.headers = { ...response.headers, 'cache-control': 'no-store' };
      return response;
    } catch (error) {
      const code = error.code || '';
      console.error('[CMS] Function error:', { code, message: error.message });

      // Give the user a specific, actionable error instead of a generic catch-all.
      if (!process.env.DATABASE_URL) {
        return json(503, 'DATABASE_URL is missing. Set your Neon connection string in Netlify environment variables with Functions scope, then redeploy. Only DATABASE_URL is required — admin credentials live in Neon.');
      }
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
        return json(503, 'Cannot connect to the database. Check that DATABASE_URL is correct and the database is reachable.');
      }
      if (code === '28P01') {
        return json(503, 'Database authentication failed. Check the username and password in DATABASE_URL.');
      }
      if (code === '3D000') {
        return json(503, 'Database does not exist. Check the database name in DATABASE_URL.');
      }
      // Fallback — include the actual error message so the user has something actionable.
      return json(503, 'CMS error: ' + (error.message || 'Unknown error') + '. Check Netlify function logs for details.');
    }
  };
}

export async function handler(event, context) {
  connectLambda(event);
  return createHandler({ mediaStore: () => getStore({ name: 'osr-media', consistency: 'strong' }) })(event, context);
}