#!/bin/sh
# Generates self-signed SSL certs for local Docker testing.
# For production, replace with real certs from Let's Encrypt / certbot.

CERT_DIR="$(dirname "$0")/certs"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
  echo "SSL certs already exist in $CERT_DIR — skipping."
  exit 0
fi

echo "Generating self-signed SSL certificate..."
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout "$CERT_DIR/privkey.pem" \
  -out "$CERT_DIR/fullchain.pem" \
  -subj "/C=US/ST=Dev/L=Dev/O=Vouch/CN=localhost"

echo "Done. Certs written to $CERT_DIR/"
