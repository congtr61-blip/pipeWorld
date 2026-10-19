# Pipe World Homepage and Inquiry System

This project includes:
- the static homepage in `index.html`
- dedicated Botswana landing pages for HDPE pressure pipe, U-PVC pressure pipe and electrical conduit
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

## Search indexing and social previews

The public pages include canonical URLs, Open Graph/Twitter share metadata, product and breadcrumb structured data,
and visible FAQs with matching FAQ structured data. `sitemap.xml` lists the homepage, product pages and FAQ page;
`robots.txt` points crawlers to the sitemap and excludes the admin page and API routes. Factory gallery image filenames
are already descriptive English names, and the gallery creates a descriptive `alt` value from each filename.

To enable Google Search Console reporting, a site owner needs to:

1. Sign in to [Google Search Console](https://search.google.com/search-console/) with the Google account that should
   own the property.
2. Add `https://www.pipeworld-bw.com/` as a URL-prefix property and complete Google's ownership verification. DNS
   verification is also available if you prefer to verify the whole domain.
3. After the production deployment is live, open **Sitemaps** for the property and submit
   `https://www.pipeworld-bw.com/sitemap.xml`.
4. Use **URL inspection** to request indexing for the homepage, three product pages and FAQ page. Search Console
   reporting begins after Google crawls the site; indexing and appearance of rich results are not guaranteed.

FAQ structured data must match visible answers. Google currently limits FAQ rich-result display, so adding this markup
does not guarantee expanded search listings. Product structured data deliberately omits price and offers because
products are quotation-based; this may not qualify the pages for Google's product rich results, which can require
pricing or other offer details.

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
- The homepage opens with a four-image factory and delivery slideshow, with manual slide selectors, pause/resume controls, and reduced-motion support. The **Factory** section includes all 42 WeChat photos as optimized, lazy-loaded gallery images under `assets/factory-gallery/`, paginated eight at a time on desktop and four at a time on mobile; the original source files remain in `assets/wechat/`.

## Admin login

Open `/admin.html` and sign in with the values from `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

Set a strong `ADMIN_PASSWORD` and a long random `ADMIN_SESSION_SECRET` before deployment.
Admin access uses an HTTP-only session cookie; the browser does not store the password.
