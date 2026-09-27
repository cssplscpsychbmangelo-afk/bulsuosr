import { connectLambda, getStore } from '@netlify/blobs';
export async function handler(event) {
  if (!['GET', 'HEAD'].includes(event.httpMethod)) return { statusCode: 405, body: '' };
  connectLambda(event);
  const name = event.path.replace(/^\/(?:uploads|\.netlify\/functions\/media)\//, '');
  if (!/^[\w.-]+$/.test(name)) return { statusCode: 404, body: 'Not found' };
  try {
    const file = await getStore({ name: 'osr-media', consistency: 'strong' }).getWithMetadata(name, { type: 'arrayBuffer' });
    if (!file) return { statusCode: 404, body: 'Not found' };
    return {
      statusCode: 200,
      headers: {
        'content-type': file.metadata.type || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'public, max-age=300',
      },
      isBase64Encoded: true,
      body: event.httpMethod === 'HEAD' ? '' : Buffer.from(file.data).toString('base64'),
    };
  } catch (error) {
    console.error('[CMS] Media read failed:', error.message);
    return { statusCode: 503, body: 'Media temporarily unavailable' };
  }
}
