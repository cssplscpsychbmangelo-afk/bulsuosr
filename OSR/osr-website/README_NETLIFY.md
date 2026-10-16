# Netlify deployment

Deploy from the repository root using its `netlify.toml`. The build handles everything
automatically — no separate backend or Render needed.

## Required environment variables

Set these in Netlify → Site configuration → Environment variables (with **Functions** scope):

- `DATABASE_URL` — your Neon pooled connection string
- `JWT_SECRET` — any random string of 32+ characters

`JWT_SECRET` is optional — one is generated and persisted in the database so
sessions survive cold starts. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are ignored:
the first administrator is created by the setup form on `/admin`.

## First login

There is no default account. After your first deploy, go to `/admin` and the
setup form creates the first administrator — the email and password you choose
there are the only ones that exist. Go to **Settings → Account** to change them
later.

## How it works

The first API request creates the database schema. It seeds **no** credentials:
the site ships no known email or password, and `ADMIN_EMAIL` / `ADMIN_PASSWORD`
environment variables are ignored. CMS data lives in Neon; uploaded media lives
in Netlify Blobs.

Full setup and troubleshooting: [deployment guide](../server/DEPLOY.md).