# P.R.I.S.M.

P.R.I.S.M. is a static student dashboard website built with HTML, CSS, and JavaScript.

## Live deployment

This project is configured for GitHub Pages deployment through GitHub Actions.

## Local preview

Open the project in a browser or run:

```bash
python3 -m http.server 8000
```

Then visit:

```text
http://localhost:8000/
```

## Dashboard data

Homework tasks and due dates drive the priorities and upcoming-deadlines panels. Add or complete tasks in the task matrix to keep those panels current. Manage daily activities from Settings -> Schedule, and edit class notes directly in the Class Notes panel. These items are saved in the current browser's local storage.

Color themes and font choices are independent. Choose a typeface from Settings -> Themes. Settings -> Layout AI includes ready-made layouts and a Groq-powered CSS generator. Generated CSS is checked against a browser-side allowlist and saved only in that browser; it does not modify or publish the website source.

Settings -> Teacher Controls lets a Google-authenticated user request teacher access. The configured administrator receives an email and can approve or deny requests in that panel. Approval creates a server-side teacher role; student linking and teacher dashboard editing tools are not implemented yet.

### Configure shared Groq layout AI

The static GitHub Pages site must not contain a Groq API key. The optional Cloudflare Worker in `workers/layout-ai.mjs` keeps the shared key server-side and applies a per-IP rate limit.

The Worker is deployed at `https://prism-layout-ai.giladcaldwell11.workers.dev`. To activate its Groq integration, open Terminal in this repository and run `npx --yes wrangler@4.151.3 secret put GROQ_API_KEY`. Paste the Groq key only into Wrangler's secure prompt. Do not put it in chat, frontend code, or a committed file. After adding the secret, push the updated site to `main` so GitHub Pages publishes the shared Worker endpoint.

The Worker only accepts the configured GitHub Pages origin and limits each IP to 12 requests per minute (Cloudflare's rate limiting is approximate). The endpoint is public, so visitors may consume your Groq quota; configure provider-side usage limits and monitor usage. Do not publish the API key or put it in frontend code.

### Configure teacher permission requests

Teacher permissions use Google-verified account identity, Cloudflare D1 for pending requests and approved roles, and Resend to email the administrator. The browser does not grant roles locally. Until this service is configured and deployed, teacher permission requests return a setup error.

1. Create a D1 database: `npx --yes wrangler@4.151.3 d1 create prism-teacher-permissions`.
2. Copy the returned database ID into `database_id` in `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.
3. Apply the schema: `npx --yes wrangler@4.151.3 d1 migrations apply prism-teacher-permissions --remote`.
4. Configure the administrator's Google account email: `npx --yes wrangler@4.151.3 secret put TEACHER_ADMIN_EMAIL`.
5. Add a Resend API key: `npx --yes wrangler@4.151.3 secret put RESEND_API_KEY`.
6. Set `TEACHER_REQUEST_FROM` to a sender address on a domain verified in Resend: `npx --yes wrangler@4.151.3 secret put TEACHER_REQUEST_FROM`.
7. Deploy the Worker with `npx --yes wrangler@4.151.3 deploy`, then publish the frontend changes to GitHub Pages.

The administrator signs into P.R.I.S.M. using the same Google account configured as `TEACHER_ADMIN_EMAIL`, then opens Settings -> Teacher Controls to review requests. Approval grants the requesting Google account a teacher role. The current implementation does not yet link teacher accounts to student accounts or provide teacher editing tools.

## Publishing to GitHub Pages

1. Push this repository to GitHub.
2. In the GitHub repo, open Settings -> Pages.
3. Set Source to GitHub Actions.
4. The workflow in `.github/workflows/deploy-pages.yml` will deploy the site automatically on each push to `main`.

## Update workflow

Because the site is static, you can continue editing the files in this project and push to GitHub to update the public website.
