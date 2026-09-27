# Netlify deployment

Deploy from the repository root using its `netlify.toml`. The build handles everything
automatically — no separate backend or Render needed.

## Required environment variables

Set these in Netlify → Site configuration → Environment variables (with **Functions** scope):

- `DATABASE_URL` — your Neon pooled connection string
- `JWT_SECRET` — any random string of 32+ characters

That's it. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are optional.

## Default login

After your first deploy, go to `/admin/login.html` and sign in with:

- **Email:** `admin@osr.bulsu.edu.ph`
- **Password:** `Admin123456!`

Go to **Settings → Account** to change your email and password immediately.

## Optional overrides

You can set `ADMIN_EMAIL` and/or `ADMIN_PASSWORD` in Netlify environment variables
to use different values for the initial account. If not set, the defaults above are used.

## How it works

The first API request creates the database schema and seeds the admin account
automatically. CMS data lives in Neon; uploaded media lives in Netlify Blobs.

Full setup and troubleshooting: [deployment guide](../server/DEPLOY.md).