#!/bin/bash -e
#
# Purpose: Extract a Chrome manifest key from a PEM private key file

if test $# -ne 1; then
  echo "Usage: make-manifest-key.sh <pem path>"
  exit 1
fi

KEY_FILE="$1"

2>/dev/null openssl rsa -in "$KEY_FILE" -pubout -outform DER | openssl base64 -A
