Install the helm chart:

```
helm install gitlab-operator gitlab/gitlab-operator
  --create-namespace
  --namespace gitlab-system
```

However, on install, SOME pods pull from dockerhub (and some from gitlab itself) <-- this is an issue as we'll hit rate limits

```
# patch the dockerhub images to the registry

kubectl -n gitlab-system patch gitlab gitlab --type=merge -p "$(cat <<'JSON'
{
  "spec": {
    "chart": {
      "values": {
        "global": {
          "image": { "registry": "registry.gitlab.com" }
        },
        "postgresql": {
          "image": {
            "registry": "harbor-test.content.tmm.broadcom.lab",
            "repository": "proxy/bitnamilegacy/postgresql",
            "tag": "16.6.0"
          },
          "metrics": {
            "enabled": true,
            "image": {
              "registry": "harbor-test.content.tmm.broadcom.lab",
              "repository": "proxy/bitnamilegacy/postgres-exporter",
              "tag": "0.15.0-debian-11-r7"
            }
          }
        },
        "redis": {
          "image": {
            "registry": "harbor-test.content.tmm.broadcom.lab",
            "repository": "proxy/bitnamilegacy/redis",
            "tag": "7.2.5"
          },
          "metrics": {
            "enabled": true,
            "image": {
              "registry": "harbor-test.content.tmm.broadcom.lab",
              "repository": "proxy/bitnamilegacy/redis-exporter",
              "tag": "1.67.0"
            }
          }
        },
        "minio": {
          "image": {
            "registry": "harbor-test.content.tmm.broadcom.lab",
            "repository": "proxy/minio/minio",
            "tag": "RELEASE.2024-09-22T00-33-43Z"
          }
        }
      }
    }
  }
}
JSON
)"



# might need to switch MinIO to the correct schema
kubectl -n gitlab-system patch gitlab gitlab --type=json -p='[
  {"op":"replace","path":"/spec/chart/values/minio/image","value":"harbor-test.content.tmm.broadcom.lab/proxy/minio/minio"},
  {"op":"replace","path":"/spec/chart/values/minio/imageTag","value":"RELEASE.2024-09-22T00-33-43Z"}
]'

# and workhorse
kubectl -n gitlab-system patch gitlab gitlab --type=json -p='[
  {"op":"add","path":"/spec/chart/values/gitlab/webservice/workhorse","value":{
    "image":"registry.gitlab.com/gitlab-org/build/cng/gitlab-workhorse-ee",
    "tag":"v18.4.1"
  }}
]'
```

Now, the jobs still contain reference to dockerhub, so need to patch these:

```
job=$(k -n gitlab-system get jobs -o NAME | grep bucket)


# update job with our repo
kubectl -n gitlab-system patch job $job \
  --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/image","value":"harbor-test.content.tmm.broadcom.lab/proxy/minio/mc:RELEASE.2018-07-13T00-53-22Z"}]'

# delete the old job
kubectl -n gitlab-system delete job -l app=minio,component=create-buckets

# tweak a value to force a reconcile (no functional change, just a nudge)
kubectl -n gitlab-system patch gitlab gitlab --type=json -p='[
  {"op":"add","path":"/spec/chart/values/minio","value":{}},
  {"op":"add","path":"/spec/chart/values/minio/dummyNonce","value":"'$(date +%s)'"}
]'

# watch for a NEW create-buckets job to appear
kubectl -n gitlab-system get jobs -w

```

added custom cert harbor-ca

```
# create secret in gitlab system for our harbor repo
kubectl -n gitlab-system create secret generic harbor-ca --from-file=ca.crt=/usr/local/share/ca-certificates/harbor-ca.crt

# patch to use the customCA
kubectl -n gitlab-system patch gitlab gitlab --type=merge -p '{
  "spec": {
    "chart": {
      "values": {
        "global": {
          "image": {
            "registry": "harbor-test.content.tmm.broadcom.lab"
          },
          "certificates": {
            "customCAs": [ { "secret": "harbor-ca" } ]
          }
        }
      }
    }
  }
}'
```

needed to add a static entry to coredns to reach our dns:

```

    content.tmm.broadcom.lab:53 {
        forward . 10.160.201.1
        cache 30
        errors
    }


# thus:

$ kubectl -n kube-system edit configmap coredns

apiVersion: v1
data:
  Corefile: |
    content.tmm.broadcom.lab:53 {
      forward . 10.160.201.1
      cache 30
      errors
    }
    .:53 {
        errors
        health {
           lameduck 5s
        }
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
           ttl 30
        }
        prometheus :9153
        forward . /etc/resolv.conf {
           max_concurrent 1000
        }
        cache 30 {
           disable success cluster.local
           disable denial cluster.local
        }
        loop
        reload
        loadbalance
    }
kind: ConfigMap
metadata:
  creationTimestamp: "2025-09-29T10:42:01Z"
  name: coredns
  namespace: kube-system
  resourceVersion: "2689059"
  uid: 396e40ee-c5f0-46bb-a1bc-014d5d2a77fe

```

added harbor cert to supervisor <-- not sure if this is needed, but...

```
$ kubectl edit configmap image-fetcher-ca-bundle -n kube-system

# Append the contents of the Harbor ca.cert file to the ConfigMap beneath the existing Supervisor certificate. Make sure not to change the Supervisor certificate.  apiVersion: v1
data:
 ca-bundle: |-
   -----BEGIN CERTIFICATE-----
 [ existing supervisor cert (don't touch) ]
   -----END CERTIFICATE-----
   -----BEGIN CERTIFICATE-----
   >>>> [ HARBOR CERT ] <<<<
   -----END CERTIFICATE-----    
kind: ConfigMap
metadata:
.
.
```

Finally, added extra 800GiB disk on the vsphere ui / consumption interface to the VKS nodes
