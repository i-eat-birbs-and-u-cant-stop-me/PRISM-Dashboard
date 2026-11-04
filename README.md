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

### Configure shared Groq layout AI

The static GitHub Pages site must not contain a Groq API key. The optional Cloudflare Worker in `workers/layout-ai.mjs` keeps the shared key server-side and applies a per-IP rate limit.

The Worker is deployed at `https://prism-layout-ai.giladcaldwell11.workers.dev`. To activate its Groq integration, open Terminal in this repository and run `npx --yes wrangler@4.151.3 secret put GROQ_API_KEY`. Paste the Groq key only into Wrangler's secure prompt. Do not put it in chat, frontend code, or a committed file. After adding the secret, push the updated site to `main` so GitHub Pages publishes the shared Worker endpoint.

The Worker only accepts the configured GitHub Pages origin and limits each IP to 12 requests per minute (Cloudflare's rate limiting is approximate). The endpoint is public, so visitors may consume your Groq quota; configure provider-side usage limits and monitor usage. Do not publish the API key or put it in frontend code.

## Publishing to GitHub Pages

1. Push this repository to GitHub.
2. In the GitHub repo, open Settings -> Pages.
3. Set Source to GitHub Actions.
4. The workflow in `.github/workflows/deploy-pages.yml` will deploy the site automatically on each push to `main`.

## Update workflow

Because the site is static, you can continue editing the files in this project and push to GitHub to update the public website.
