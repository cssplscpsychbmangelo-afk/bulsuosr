import rateLimit from 'express-rate-limit';

// Netlify Functions may not populate req.ip; fall back to the edge's client headers.
export const clientKey = req => String(
  req.get('x-nf-client-connection-ip')
  || (req.get('x-forwarded-for') || '').split(',')[0].trim()
  || req.ip
  || 'anon'
);

/* What the public read endpoints are up against.
   Everything a visitor downloads is one Netlify Function invocation, and the
   free tier allows 125,000 of them a month. A script that asks for the
   academic calendar in a loop spends that allowance in minutes, so the read
   endpoints are throttled like the write endpoints already were.

   The limit is read per request rather than frozen at import, so the tests can
   lower it and prove the throttle actually fires. It is deliberately generous:
   a university campus shares one public address, and a lecture hall full of
   students loading the site must not lock each other out. 300 a minute is five
   a second — far above browsing, far below a loop.

   It is also honest about what it is: one lambda's memory. A distributed
   attack spreads across instances and ignores this completely. The durable
   defences are the ones next door — a capped response, a cacheable response,
   and one request per page load instead of eleven. */
export const publicReadLimit = () => Number(process.env.PUBLIC_READ_LIMIT || 300);

export const publicReadLimiter = rateLimit({
  keyGenerator: clientKey,
  validate: false,
  windowMs: 60 * 1000,
  limit: publicReadLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this connection. Please try again in a minute.' },
});
