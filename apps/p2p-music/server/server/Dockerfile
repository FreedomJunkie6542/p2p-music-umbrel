FROM node:18-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npx tsc
FROM node:18-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist

ENV PORT=3005
EXPOSE 3005
CMD ["node", "dist/index.js"]
