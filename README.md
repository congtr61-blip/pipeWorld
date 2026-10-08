# Pipe World Homepage and Inquiry System

This project includes:
- the static homepage in `index.html`
- a real inquiry API at `/api/contact`
- an admin dashboard at `/admin.html` for enquiries and bilingual cooperation cases
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
2. Open **SQL Editor**, create a query, paste the contents of [`supabase/setup.sql`](./supabase/setup.sql), and select **Run**. This is safe to rerun; it adds the enquiry workflow columns and creates the atomic rate-limit function/table. Existing inquiry records are retained.
3. Open **Project Settings > API Keys** (in some dashboard versions this is under **Project Settings > API**).
   - Copy **Project URL** to `SUPABASE_URL`.
   - Copy the server-side **Secret key** (or legacy `service_role` key) to `SUPABASE_SERVICE_ROLE_KEY`.
   - Do not use the publishable/anon key as the service key. `SUPABASE_ANON_KEY` is optional for this project.
   - Keep the secret key only in `.env` locally and Vercel environment variables in production. Never put it in `index.html` or send it in chat.

Verify new submissions and the workflow columns from **SQL Editor**:

```sql
select id, name, email, status, admin_notes, created_at, updated_at
from public.inquiries
order by created_at desc
limit 20;
```

When both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, submissions are written to the Supabase `inquiries` table. If the service key is blank, local submissions are stored in `data/inquiries.json` instead. The admin dashboard now labels which storage it is displaying.

The existing local test submissions are in `data/inquiries.json`; they are not automatically copied into Supabase when you add the key. Once the table and key are configured, migrate those records with:

```powershell
npm.cmd run migrate:local
```

This uses upsert on the inquiry ID, so rerunning it will not create duplicate copies. Vercel's function filesystem is not persistent; production must have Supabase configured.

## Email delivery

Inquiry notification emails are sent to `FORWARD_EMAIL`; this remains the forwarding inbox configured for quote follow-up. The public website contact address is unchanged. Create an API key in the Resend dashboard under **API Keys** and set it as `RESEND_API_KEY`. For production delivery, verify a sending domain in Resend under **Domains** and use an address from that verified domain for `EMAIL_FROM`; the address can forward replies using `replyTo` without being a separately hosted inbox. Until the API key is configured, enquiries can still be saved to Supabase, but email notifications will not be sent.

## Inquiry abuse protection and admin workflow

- The contact form includes a hidden honeypot field, validates email/type/length server-side and limits each client to **5 enquiries per 15 minutes**.
- Production rate limits are enforced atomically in Supabase. The address is HMAC-hashed before storage; raw IP addresses are not kept in the rate-limit table.
- After applying the SQL setup, verify Vercel's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured. If the production rate-limit RPC has not been created, the endpoint returns an error rather than silently accepting unprotected submissions.
- The inquiry form explains that contact details are used to answer the inquiry and securely retained for follow-up.
- The admin dashboard supports search, status/type filters, 10/25/50-row pagination, CSV export, and per-inquiry status/internal notes.
- Workflow statuses: `new`, `in_progress`, `replied`, and `completed`.
- If inquiries were already present in Supabase when setup is applied, they receive the default status `new`; admin notes start blank.

After changing database schema or functions, redeploy the Vercel project so the API code and Supabase schema are in sync.

## Social link and cooperation cases

- The public Facebook link points to `https://www.facebook.com/profile.php?id=61595181328626` in the desktop contact strip and footer. WhatsApp has intentionally not been added until a business number is provided.
- Run [`supabase/cases.sql`](./supabase/cases.sql) in the same Supabase SQL Editor. It creates the case table and a public-read image bucket; case records themselves remain private to the server API.
- The admin dashboard has an **Enquiries / Cooperation cases** switch. The case editor uses basic English/Chinese text fields, a single optional JPG/PNG/WebP cover (up to 2.5 MB), and a draft/publish selector. No HTML or rich-text formatting is required.
- Published cases appear in the homepage **Cooperation cases** section between Applications and Plant & Equipment. Drafts remain visible only in the admin dashboard.
- Case creation and updates require a Supabase service-role key and the `project_cases` table plus `pipeworld-cases` storage bucket. Apply the SQL before deploying the new API.

## Admin login

Open `/admin.html` and sign in with the values from `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

Set a strong `ADMIN_PASSWORD` and a long random `ADMIN_SESSION_SECRET` before deployment.
Admin access uses an HTTP-only session cookie; the browser does not store the password.
