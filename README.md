# Pipe World Homepage and Inquiry System

This project includes:
- the static homepage in `index.html`
- a real inquiry API at `/api/contact`
- an admin dashboard at `/admin.html`
- local fallback storage for submissions when Supabase is not configured

## Local setup

1. Install Node.js 20 or later from [nodejs.org](https://nodejs.org/) and reopen VS Code.
   In the VS Code terminal, confirm `node -v` works.
   If the terminal is PowerShell and `npm` is blocked by the script execution policy, use the Windows command shim `npm.cmd` instead:
   ```powershell
   npm.cmd -v
   npm.cmd install
   npm.cmd run dev
   ```
   Alternatively, switch the VS Code terminal profile to **Command Prompt** and use `npm` normally.
2. Install dependencies:
   `npm install` (or `npm.cmd install` in PowerShell)
3. Copy `.env.example` to `.env` and fill in the values.
4. Start the app locally with:
   `npm run dev` (or `npm.cmd run dev` in PowerShell)
5. Open the site at `http://localhost:3000`.

## Production deployment

Deploy to Vercel and add the same environment variables in Project Settings > Environment Variables.
The local development server does not need a Vercel login. Vercel automatically uses the files under `api/` when deployed.

## Supabase table

1. Open the Supabase dashboard and select the `stzapkoxcdubozphnhuk` project.
2. Open **SQL Editor**, create a query, paste the SQL below, and select **Run**. Creating a project alone does not create the table.

```sql
create table if not exists public.inquiries (
  id text primary key,
  name text not null,
  email text not null,
  phone text,
  type text not null,
  subject text,
  message text not null,
  created_at timestamptz default now()
);

alter table public.inquiries enable row level security;
```

After submitting a test enquiry, check **SQL Editor** with:

```sql
select id, name, email, created_at
from public.inquiries
order by created_at desc
limit 20;
```

3. Open **Project Settings > API Keys** (in some dashboard versions this is under **Project Settings > API**).
   - Copy **Project URL** to `SUPABASE_URL`.
   - Copy the server-side **Secret key** (or legacy `service_role` key) to `SUPABASE_SERVICE_ROLE_KEY`.
   - Do not use the publishable/anon key as the service key. `SUPABASE_ANON_KEY` is optional for this project.
   - Keep the secret key in `.env` locally and Vercel environment variables in production. Never put it in `index.html` or send it in chat.

When both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, submissions are written to the Supabase `inquiries` table. If the service key is blank, local submissions are stored in `data/inquiries.json` instead. The admin dashboard now labels which storage it is displaying.

The existing local test submissions are in `data/inquiries.json`; they are not automatically copied into Supabase when you add the key. Once the table and key are configured, migrate those records with:

```powershell
npm.cmd run migrate:local
```

This uses upsert on the inquiry ID, so rerunning it will not create duplicate copies. Vercel's function filesystem is not persistent; production must have Supabase configured.

## Email delivery

Create an API key in the Resend dashboard under **API Keys** and set it as `RESEND_API_KEY`. Set `FORWARD_EMAIL` to the mailbox that should receive enquiries. For production delivery, verify a sending domain in Resend under **Domains** and use an address from that verified domain for `EMAIL_FROM`; the address can forward replies using `replyTo` without being a separately hosted inbox. Until the API key is configured, enquiries can still be saved to Supabase, but email notifications will not be sent.

## Admin login

Open `/admin.html` and sign in with the values from `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

Set a strong `ADMIN_PASSWORD` and a long random `ADMIN_SESSION_SECRET` before deployment.
Admin access uses an HTTP-only session cookie; the browser does not store the password.
