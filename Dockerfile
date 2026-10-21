# Chess rules: shakmaty compiled to WebAssembly.
FROM rust:1-slim AS core
RUN rustup target add wasm32-unknown-unknown && cargo install wasm-bindgen-cli --version 0.2.129 --locked
WORKDIR /app
COPY core/Cargo.toml core/Cargo.lock core/
COPY core/src core/src
COPY scripts/build-core.sh scripts/
RUN sh scripts/build-core.sh

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
COPY --from=core /app/core/pkg core/pkg
RUN npm run build:app

FROM node:22-slim
# python3 so script engines (*.py) run too; node is already here for *.js engines.
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production ENGINES_DIR=/engines PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server/server/index.js"]
