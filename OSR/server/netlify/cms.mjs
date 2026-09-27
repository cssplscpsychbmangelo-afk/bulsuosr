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
      const secret = process.env.JWT_SECRET || '';
      if (secret.length < 32 || secret !== secret.trim()) {
        return json(503, 'Set JWT_SECRET (32+ random characters) in Netlify environment variables, then redeploy.');
      }
      if (!process.env.DATABASE_URL) {
        return json(503, 'Set DATABASE_URL in Netlify environment variables with Functions scope, then redeploy.');
      }
      const db = await database();
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
      console.error('[CMS] Database/function request failed', { code: error.code || 'CONFIG_OR_STORAGE' });
      return json(503, 'CMS is unavailable. Check DATABASE_URL, ADMIN_PASSWORD and JWT_SECRET in Netlify Functions settings.');
    }
  };
}

export async function handler(event, context) {
  connectLambda(event);
  return createHandler({ mediaStore: () => getStore({ name: 'osr-media', consistency: 'strong' }) })(event, context);
}
