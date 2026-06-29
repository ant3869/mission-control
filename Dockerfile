FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run check && npm test && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir data
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "--import", "tsx", "server/index.ts"]
