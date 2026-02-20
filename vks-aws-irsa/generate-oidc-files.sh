
#!/usr/bin/env bash
# SAMPLE script to generate OIDC discovery and JWKS files for AWS IAM OIDC provider
#
# IMPORTANT: This is a SAMPLE script provided for reference purposes only.
# Customers must review, modify, and test this script according to their
# specific requirements and security policies.
#
# DISCLAIMER: This script is provided "as is" without warranty.
# Use at your own risk. Not supported.
#
# Prerequisites:
# - Service account public key available
# - jq installed
# - openssl installed
#
# Usage:
#   ./generate-oidc-files.sh <issuer-url> <public-key-file>
#
# Example:
#   ./generate-oidc-files.sh \
#     "https://example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity" \
#     sa.pem

set -euo pipefail

if [ $# -ne 2 ]; then
    echo "Usage: $0 <issuer-url> <public-key-file>"
    echo ""
    echo "Example:"
    echo "  $0 'https:/bucket.s3.region.amazonaws.com/clustername' sa.pub"
    exit 1
fi

ISSUER_URL="$1"
PUBKEY_FILE="$2"

if [ ! -f "$PUBKEY_FILE" ]; then
    echo "Error: Public key file not found: $PUBKEY_FILE"
    exit 1
fi

# Validate required tools
for cmd in jq openssl; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "Error: Required command '$cmd' not found"
        exit 1
    fi
done

echo "Generating OIDC discovery and JWKS files..."
echo "Issuer URL: $ISSUER_URL"
echo "Public Key: $PUBKEY_FILE"
echo ""

# Generate OIDC Discovery Document
cat > openid-configuration.json <<EOF
{
  "issuer": "${ISSUER_URL}",
  "jwks_uri": "${ISSUER_URL}/keys.json",
  "response_types_supported": ["id_token"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"]
}
EOF

echo "✓ Created openid-configuration.json"


#PUBKEY_FILE="./sa.pem"
OUTPUT_FILE="./keys.json"

# Dependencies check
for cmd in openssl jq base64 awk xxd tr; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd not found." >&2
    exit 1
  fi
done

# the kid value is the SHA256 of the DER of the Public Key that is Base64URL encoded.  This is required by AWS
# kid value must match the kid field in the POD accescessing AWS SA Token.  The kid acts as a pointer to the public key file (i.e kid on cluster needs to match kid in keys.json)
# You can check pod SA Token by decoding the JWT using: kubectl exec -n default aws-cli-test -- cat /var/run/secrets/kubernetes.io/serviceaccount/token \
#  | awk -F. '{
#      # Header
#      h=$1; while(length(h)%4!=0) h=h"="; gsub(/-/,"+",h); gsub(/_/,"/",h);
#      # Payload
#      p=$2; while(length(p)%4!=0) p=p"="; gsub(/-/,"+",p); gsub(/_/,"/",p);
#      print "HEADER:"; print h | "base64 -d | jq"; close("base64 -d | jq");
#      print "PAYLOAD:"; print p | "base64 -d | jq"; close("base64 -d | jq");
#  }'


# Compute KID (base64url(sha256(DER))) ===
DER_FILE=$(mktemp)
openssl rsa -pubin -in "$PUBKEY_FILE" -outform DER -out "$DER_FILE" 2>/dev/null
KID=$(openssl dgst -sha256 -binary "$DER_FILE" | base64 | tr '+/' '-_' | tr -d '=')

# AWS requirement: n must be raw modulus bytes, base64url encoded, no leading 0 byte, no padding.
# Why: AWS validates JWT signatures against this exact modulus.  The below sections correct calculate this value

# Extract modulus & exponent cleanly ===
RSA_TEXT=$(openssl rsa -pubin -in "$PUBKEY_FILE" -text -noout 2>/dev/null)

# Extract Modulus (remove whitespace/colons)
N_HEX=$(echo "$RSA_TEXT" | awk '/Modulus/{flag=1;next}/Exponent/{flag=0}flag' | tr -d '[:space:]:' | tr -d '\n')

# Remove leading 00 byte if present (OpenSSL encodes positive integers with it)
if [[ "${N_HEX:0:2}" == "00" ]]; then
  N_HEX="${N_HEX:2}"
fi

# Extract exponent decimal
E_DEC=$(echo "$RSA_TEXT" | awk '/Exponent/{print $2}' | tr -d '()')

# Convert to base64url
N_B64=$(echo "$N_HEX" | xxd -r -p | base64 | tr '+/' '-_' | tr -d '=')
E_HEX=$(printf "%x" "$E_DEC")
if [ $(( ${#E_HEX} % 2 )) -ne 0 ]; then E_HEX="0$E_HEX"; fi
E_B64=$(echo "$E_HEX" | xxd -r -p | base64 | tr '+/' '-_' | tr -d '=')

#  Write JWKS JSON
jq -n --arg kty "RSA" \
      --arg use "sig" \
      --arg alg "RS256" \
      --arg kid "$KID" \
      --arg n "$N_B64" \
      --arg e "$E_B64" \
      '{keys: [{kty: $kty, use: $use, alg: $alg, kid: $kid, n: $n, e: $e}]}' \
  > "$OUTPUT_FILE"

echo "JWKS written to $OUTPUT_FILE"
jq . "$OUTPUT_FILE"

rm -f "$DER_FILE"



echo "Created keys.json"
echo ""

# Validate JSON files
echo "Validating JSON files..."
jq empty openid-configuration.json && echo "✓ openid-configuration.json is valid JSON"
jq empty keys.json && echo "✓ keys.json is valid JSON"
echo ""

BUCKET=$(echo "$ISSUER_URL" | sed -E 's#^https?://([^./]+).*#\1#')
FILE_PATH=$(echo "$ISSUER_URL" | cut -d'/' -f4)


# Display upload instructions
echo "Upload instructions:"
echo ""
echo "  # Extract bucket and path from issuer URL"
echo "  BUCKET=\$(echo '$ISSUER_URL' | cut -d'/' -f4)"
echo "  FILE_PATH=\$(echo '$ISSUER_URL' | cut -d'/' -f5-)"
echo ""
echo " The Bucket is: $BUCKET"
echo " The File Path is: $FILE_PATH"
echo ""
echo "  # Upload OIDC discovery document"
echo "  aws s3 cp openid-configuration.json \\"
echo "    s3://${BUCKET}/${FILE_PATH}/.well-known/openid-configuration \\"
echo "    --content-type application/json"
echo ""
echo "  # Upload JWKS"
echo "  aws s3 cp keys.json \\"
echo "    s3://${BUCKET}/${FILE_PATH}/keys.json \\"
echo "    --content-type application/json "
echo ""
echo "  # Verify uploads"
echo "  curl -s ${ISSUER_URL}/.well-known/openid-configuration | jq"
echo "  curl -s ${ISSUER_URL}/keys.json | jq"
echo ""

# Display files for review
echo "Generated files:"
echo ""
echo "=== openid-configuration.json ==="
jq . openid-configuration.json
echo ""
echo "=== keys.json ==="
jq . keys.json
echo ""

echo "OIDC files generated successfully!"
