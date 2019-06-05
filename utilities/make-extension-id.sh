#!/bin/bash -e
#
# Purpose: Extract a Chrome extension ID from a PEM private key file

if test $# -ne 1; then
  echo "Usage: make-extension-id.sh <pem path>"
  exit 1
fi

KEY_FILE="$1"

2>/dev/null openssl rsa -in "$KEY_FILE" -pubout -outform DER | sha256sum | head -c32 | tr 0-9a-f a-p
