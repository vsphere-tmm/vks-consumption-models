# First setup certs #

Here we use a wildcard cert


1.    Tell gitlab to use this secret on all ingresses

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

2. Make runners trust the CA:

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
}'

# change the traffic policy to allow external traffic (not sure if this is needed, but...)
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

# Update the gitlab runner Helm values file (and update Helm package) #

See the 'gitlab-runner-values.yaml' file. We need a TOML fragment

```
  config: |
    [[runners]]
      executor = "kubernetes"
      [runners.kubernetes]
        image        = "ubuntu:22.04"
        helper_image = "harbor-test.content.tmm.broadcom.lab/library/gitlab-runner-helper:x86_64-latest"
        poll_timeout = 600
        privileged   = true
 ```       

 Update Helm package:

 ```
 helm upgrade gitlab-runner gitlab/gitlab-runner \
  -n gitlab-runners \
  -f gitlab-runner-values.yaml
```

ensure the runner pod is active

```
kubectl -n gitlab-runners get pods

NAME                             READY   STATUS    RESTARTS   AGE
gitlab-runner-5f6f44d554-5mwhx   1/1     Running   0          72s
```
