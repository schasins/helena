#!/bin/bash -e
#
# Purpose: Generate a PEM private key file suitable for use with a Chrome extension

if test $# -ne 1; then
  echo "Usage: make-pem-key.sh <pem path>"
  exit 1
fi

KEY_FILE="$1"

2>/dev/null openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out "$KEY_FILE"
