
```
#create a full chain cert
cat harbor.cer chain.pem > fullchain.crt

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

```
# added more storage to harbor... 2TiB

k -n svc-harbor-domain-c25 patch pvc harbor-registry \
  -p '{"spec":{"resources":{"requests":{"storage":"2Ti"}}}}'
```