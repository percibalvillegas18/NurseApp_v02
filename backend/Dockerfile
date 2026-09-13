FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
# --only=production is deprecated in npm 10; --omit=dev is the supported form.
# Dev deps are still needed to build, which happens in the builder stage above.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 4000

# `nest build` now uses tsconfig.build.json (include: src/**) so the bundle is
# emitted flat at dist/main.js. It previously landed at dist/src/main.js and
# this CMD crashed the container with MODULE_NOT_FOUND.
# Use `node dist/src/main.js` if you build with the root tsconfig instead.
CMD ["node", "dist/main.js"]

# Development stage
FROM node:20-alpine AS development

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate

EXPOSE 4000

CMD ["npm", "run", "start:dev"]
