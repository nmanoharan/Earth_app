# Deploying the Forest Cover App to Vercel

This project is an npm workspace monorepo. Deploy the web app only:

`apps/web`

The mobile app in `apps/mobile` is for Expo and is not deployed to Vercel.

## Option 1: Deploy With GitHub and Vercel

1. Open this folder:

   `/Users/nitinmanohar/Documents/Codex/2026-05-27/create-a-detailed-plan-for-codex`

2. Create a GitHub repository and push the project:

   ```sh
   git init
   git add -A
   git commit -m "Initial forest cover app"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

3. In Vercel, choose **Add New... > Project**.

4. Import the GitHub repository.

5. Set the Vercel project **Root Directory** to:

   `apps/web`

6. Use these build settings:

   - Framework Preset: `Next.js`
   - Install Command: `npm install`
   - Build Command: `npm run build`
   - Output Directory: leave default

7. Click **Deploy**.

## Option 2: Deploy From Your Terminal

From the repository root:

```sh
cd /Users/nitinmanohar/Documents/Codex/2026-05-27/create-a-detailed-plan-for-codex
npm install
npm run build:web
npm install -g vercel
vercel
```

When Vercel asks which directory contains the app, choose:

`apps/web`

For production:

```sh
vercel --prod
```

## Using v0 / Vercel AI

If you mean Vercel's AI builder, v0:

1. Go to `https://v0.dev`.
2. Start a new chat.
3. Describe the app:

   `Create a Next.js forest cover explorer with an interactive US map, layer toggles for tree cover, forest loss, and land cover, plus a year slider and API route for layer metadata.`

4. Ask v0 to generate a Next.js App Router project.
5. Use v0's **Deploy** button to publish to Vercel.

This existing local project already has the generated code, so the GitHub + Vercel path is the best way to deploy exactly what is on your machine.

