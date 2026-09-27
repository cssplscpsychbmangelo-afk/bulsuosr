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
        return json(503, 'JWT_SECRET is missing or too short. Set it to 32+ random characters in Netlify environment variables, then redeploy.');
      }
      if (!process.env.DATABASE_URL) {
        return json(503, 'DATABASE_URL is missing. Set your Neon connection string in Netlify environment variables with Functions scope, then redeploy.');
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
      const code = error.code || '';
      console.error('[CMS] Function error:', { code, message: error.message });

      // Give the user a specific, actionable error instead of a generic catch-all.
      if (!process.env.DATABASE_URL) {
        return json(503, 'DATABASE_URL is missing. Set your Neon connection string in Netlify environment variables with Functions scope, then redeploy.');
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
      if (error.message && error.message.includes('ADMIN_EMAIL')) {
        return json(503, error.message);
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