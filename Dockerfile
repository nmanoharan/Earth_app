FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
RUN npm run build:web
RUN npm prune --omit=dev

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web ./apps/web
COPY --from=deps /app/packages/shared ./packages/shared

WORKDIR /app/apps/web
EXPOSE 8080

CMD ["npm", "run", "start", "--", "-p", "8080"]
