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

## Publishing to GitHub Pages

1. Push this repository to GitHub.
2. In the GitHub repo, open Settings -> Pages.
3. Set Source to GitHub Actions.
4. The workflow in `.github/workflows/deploy-pages.yml` will deploy the site automatically on each push to `main`.

## Update workflow

Because the site is static, you can continue editing the files in this project and push to GitHub to update the public website.
