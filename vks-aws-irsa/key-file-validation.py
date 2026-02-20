import json, base64, hashlib
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization import load_pem_public_key

# DISCLAIMER: This script is provided "as is" without warranty.
# Use at your own risk. Not supported.

# Load PEM public key
with open("./sa.pem", "rb") as f:
    pubkey = load_pem_public_key(f.read())

# Convert to DER for hashing (for KID)
der = pubkey.public_bytes(
    encoding=serialization.Encoding.DER,
    format=serialization.PublicFormat.SubjectPublicKeyInfo
)

# Compute kid same as Kubernetes: base64url(sha256(DER))
kid = base64.urlsafe_b64encode(hashlib.sha256(der).digest()).rstrip(b'=').decode()

# Extract RSA components
pub_numbers = pubkey.public_numbers()
n = base64.urlsafe_b64encode(pub_numbers.n.to_bytes((pub_numbers.n.bit_length() + 7)//8, 'big')).rstrip(b'=').decode()
e = base64.urlsafe_b64encode(pub_numbers.e.to_bytes((pub_numbers.e.bit_length() + 7)//8, 'big')).rstrip(b'=').decode()

jwks = {
    "keys": [{
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": kid,
        "n": n,
        "e": e
    }]
}

print(json.dumps(jwks, indent=2))
