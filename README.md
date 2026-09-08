# Admin Roadmap — Vercel app

Two boards over one dataset: the **Admin roadmap** (what is being built) and
**Intake requests** (what has been asked for but not started). Same pattern as
the other internal tools — static files in `public/`, one serverless function
in `api/`, Neon Postgres behind it.

```
public/index.html   page shell, loads React + Tailwind + Babel from CDNs
public/app.jsx      the whole app
api/state.js        GET / POST the saved board
schema.sql          one table
```

## Deploy

**1. Neon database.** Create one (or reuse an existing Arena database) and run
`schema.sql` against it. It creates a single `app_state` table.

**2. Vercel project.** Import the repo. No build command and no output
directory — it is a static site plus one function, so leave both blank and let
the framework preset be **Other**.

**3. Environment variable.** Add `DATABASE_URL` with the Neon pooled connection
string, for Production, Preview and Development. This is the same variable name
the other tools use.

**4. Deploy.** First load writes nothing; the first edit creates the row.

## How saving works

The board is stored as a single JSON document under the key `arena-roadmap-v5`,
written about half a second after you stop typing. The masthead shows
`Saving…`, then `Saved`, and turns red with `Not saved — check your connection`
if the write fails. That indicator matters: without it a failed save is
indistinguishable from a successful one.

Last write wins if two people edit at the same moment. For a handful of users
that is the right trade — a document write is atomic, so a dropped request can
never leave half a board behind. If simultaneous editing becomes real, split
`items` into its own table and write per row.

## Changing the seed data

`SEED` in `app.jsx` is the starting content, transcribed from the PRD sheet and
the intake sheet. Saved data wins over it, and rows are keyed by a slug derived
from name and phase, so:

- editing a seed row does **not** overwrite what someone changed in the app
- adding a seed row **does** appear on next load, with a banner saying how many
  arrived
- deleting a row in the app is remembered, so the seed will not resurrect it

That is why ids are slugs rather than a counter. With a counter, inserting one
row renumbers everything after it and saved data can no longer be matched.

## The Babel note

`app.jsx` is transpiled in the browser, which costs roughly a second on a cold
cache. It buys a zero-build deploy, matching the other tools. To remove it:
precompile `app.jsx` to plain JS, point the script tag at the output, and drop
the two Babel lines from `index.html`.

## Auth

There is none. It sits on a public Vercel URL, same as the other internal
tools. If it needs locking down, Vercel password protection on the project is
the fastest route; a PIN gate like the Recomp Check tab is the other pattern
already in use here.
