## HARBOR CERT

First create all required DNS A records 

```
# create CSR using openssl

FQDN="harbor-test.content.tmm.broadcom.lab"

openssl req -new -newkey rsa:2048 -nodes \
  -keyout harbor.key \
  -out harbor.csr \
  -subj "/CN=${FQDN}" \
  -addext "subjectAltName=DNS:${FQDN}"

# request the cert (see step 2 in wildcard cert steps below)
```

```
# create a full chain cert
cat harbor.cer chain.crt > fullchain.crt

NS="svc-harbor-domain-c25"

# create new tls secret

kubectl -n "$NS" create secret tls harbor-public-tls \
  --cert=fullchain.crt --key=harbor.key


# patch http proxy

kubectl -n "$NS" patch httpproxy harbor-httpproxy --type merge -p \
  '{"spec":{"virtualhost":{"tls":{"secretName":"harbor-public-tls"}}}}'


# confirm picked up

kubectl -n "$NS" get httpproxy harbor-httpproxy
kubectl -n "$NS" describe httpproxy harbor-httpproxy | egrep -i 'valid|reason|error' -A2


# verify from outside

FQDN="harbor-test.content.tmm.broadcom.lab"
echo | openssl s_client -servername "$FQDN" -connect "$FQDN:443" 2>/dev/null \
| openssl x509 -noout -subject -issuer -enddate -ext subjectAltName
# -> issuer should now be your AD CS CA; SAN includes the FQDN
```

## WILDCARD CERT (for gitlab runner, etc.)

1. Create a CSR (see example `wildcard.cnf`)

2. Request the cert:

Open: `https://<CA-host>/certsrv`
* Request a certificate → advanced certificate request →
* Submit a certificate request by using a base-64-encoded CMC or PKCS #10 file.
* Paste the entire contents of wildcard.csr.

In Certificate Template:
* Pick your web server template that allows SANs (e.g., Web Server, or a custom one like K8s-WebServer-Wildcard).
* Submit and download the issued cert as Base 64 encoded (save as cert.cer).
* Back on certsrv home → Download a CA certificate, certificate chain, or CRL → Download CA certificate chain (this gives you a .p7b, save as chain.p7b)

3. Convert the downloaded files

```
# convert p7b to crt
openssl pkcs7 -print_certs -in cert.p7b -out cert.crt

openssl x509 -in cert.cer -noout -text | sed -n '/Subject:/p;/Subject Alternative Name/,+1p'
```


4. Create secret

```
kubectl -n gitlab-system create secret tls gitlab-wildcard-tls \
  --cert=fullchain.pem --key=wildcard.key
```

5.    Tell gitlab to use this secret on all ingresses

```
kubectl -n gitlab-system patch gitlab gitlab --type=merge -p '{
  "spec": { "chart": { "values": {
    "global": {
      "hosts": { "domain": "content.tmm.broadcom.lab" },
      "ingress": { "tls": { "enabled": true, "secretName": "gitlab-wildcard-tls" } }
    },
    "gitlab": {
      "webservice": { "ingress": { "tls": { "secretName": "gitlab-wildcard-tls" } } },
      "kas":        { "ingress": { "tls": { "secretName": "gitlab-wildcard-tls" } } }
    },
    "registry": { "ingress": { "tls": { "secretName": "gitlab-wildcard-tls" } } },
    "minio":    { "ingress": { "tls": { "secretName": "gitlab-wildcard-tls" } } }
  } } }
}'
```

check:

```
kubectl -n gitlab-system get ingress \
  -o jsonpath='{range .items[*]}{.metadata.name}{" -> "}{.spec.tls[0].secretName}{"\n"}{end}'


echo | openssl s_client -servername gitlab.content.tmm.broadcom.lab \
  -connect gitlab.content.tmm.broadcom.lab:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -ext subjectAltName
```

6. Make runners trust the CA:

```
kubectl -n gitlab-runners delete secret ad-ca --ignore-not-found
kubectl -n gitlab-runners create secret generic ad-ca \
  --from-file=gitlab.content.tmm.broadcom.lab.crt=/path/AD-ISSUING-CA.pem \
  --from-file=registry.content.tmm.broadcom.lab.crt=/path/AD-ISSUING-CA.pem \
  --from-file=minio.content.tmm.broadcom.lab.crt=/path/AD-ISSUING-CA.pem \
  --from-file=kas.content.tmm.broadcom.lab.crt=/path/AD-ISSUING-CA.pem

helm upgrade --install gitlab-runner gitlab/gitlab-runner \
  -n gitlab-runners --reuse-values --set certsSecretName=ad-ca


# patch if needed
kubectl -n gitlab-system patch gitlab gitlab --type=merge -p '{
  spec: { chart: { values: {
    global: {
      certificates: {
        customCAs: [
          { secret: harbor-ca },
          { secret: ad-ca }
        ]
      }
    }
  } } }
}'   # change the traffic policy to allow external traffic (not sure if this is needed, but...)
kubectl -n gitlab-system patch svc gitlab-nginx-ingress-controller --type=merge -p \
'{"spec":{"externalTrafficPolicy":"Cluster","internalTrafficPolicy":"Cluster"}}'

# patch the controller
kubectl -n gitlab-system patch gitlab gitlab --type=merge -p '{
  "spec": { "chart": { "values": {
    "nginx-ingress": {
      "controller": {
        "service": {
          "externalTrafficPolicy": "Cluster",
          "internalTrafficPolicy": "Cluster"
        }
      }
    }
  } } }
}'
```
