#!/bin/sh
# Build the shakmaty-based rules (core/) to WebAssembly in core/pkg.
# Needs: rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version 0.2.129
set -e
cd "$(dirname "$0")/.."
cargo build --quiet --release --target wasm32-unknown-unknown --manifest-path core/Cargo.toml
wasm-bindgen --target web --out-dir core/pkg --out-name arena_core core/target/wasm32-unknown-unknown/release/arena_core.wasm
