# Build from the repo root:  docker build -f apps/api/Dockerfile -t noteshare-api .
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/extension/package.json apps/extension/
RUN npm ci
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @noteshare/api

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
EXPOSE 3001
# Apply pending DB migrations, then start the API.
CMD ["sh", "-c", "npm run migrate:deploy -w @noteshare/api && npm run start -w @noteshare/api"]
