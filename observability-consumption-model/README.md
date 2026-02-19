## Install Contour with Envoy ##

VKS Contour package reference:
https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vsphere-supervisor-services-and-standalone-components/latest/managing-vsphere-kuberenetes-service-clusters-and-workloads/installing-standard-packages-on-tkg-service-clusters/standard-package-reference/contour-package-reference.html

VKS Cert manager reference:
https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vsphere-supervisor-services-and-standalone-components/latest/managing-vsphere-kuberenetes-service-clusters-and-workloads/installing-standard-packages-on-tkg-service-clusters/standard-package-reference/contour-package-reference.html

Obtain the latest URL for VKS packages by referencing the VKS Standard Packages elease notes:
[https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vsphere-supervisor-services-and-standalone-components/latest/release-notes/vmware-tanzu-kubernetes-grid-service-release-notes.html](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vsphere-supervisor-services-and-standalone-components/latest/release-notes/vks-standard-packages-release-notes.html)


```
# Change context to the VKS cluster, for example
vcf context use vkscluster

# Create a namespace for the packages
kubectl create ns packages

# Add the standard package repo (url obtained from the release notes), for example:
vcf package repository add vks-repo -url \
projects.packages.broadcom.com/vsphere/supervisor/packages/2025.6.17/vks-standard-packages:v2025.6.17 \
-n packages

# Install cert manager:
# First get available versions
vcf package available get cert-manager.kubernetes.vmware.com -n packages

# Then install the cert manager package
vcf package install cert-manager -p cert-manager.kubernetes.vmware.com --version <version> -n packages


# Install Contour:
# First get available versions
vcf package available get contour.kubernetes.vmware.com -n packages

# Obtain the default values file, for example:
vcf package available get contour.kubernetes.vmware.com/1.32.0+vmware.1-vks.1 \
-default-values-file-output contour-data-values.yaml -n packages

# Update the data values file as needed, a sample is included in this repo

# Install
vcf package install contour -p contour.kubernetes.vmware.com --version 1.32.0+vmware.1-vks.1 --values-file contour-data-values.yaml -n packages
```

## Create a DNS A Record ##

```
# from the envoy external address, point it to prom, e.g.
10.163.44.43 prometheus.content.tmm.broadcom.lab

```


## Generate CSR and get certs from AD CA ##
```
# Gen CSR from openssl
openssl req -new -newkey rsa:2048 -nodes -keyout prom.key -out prom.csr -subj "/CN=prometheus.content.tmm.broadcom.lab"

# Open: `https://<CA-host>/certsrv`
# Request a certificate → advanced certificate request → web server
# Use the CSR created above
# Download the fullchain cer and p7b files & rename to 'prom.p7b' and 'prom.cer'

# Convert the p7b file 
openssl pkcs7 -print_certs -in prom.p7b -out prom.crt

# Create full-chain cert
cat prom.cer prom.crt > prom-fullchain.crt

# Add the content of these files to prometheus-data-values (see below)

```


## Install OSS Prometheus ##

Reference Prometheus' docs here: https://prometheus-operator.dev/docs/getting-started/installation/

```
# Get the latest CRD version, for example:

curl -s https://api.github.com/repos/prometheus-operator/prometheus-operator/releases/latest | grep tag_name
LATEST=<version>

# Download the Prometheus Operator (edit image registry as needed)
curl -sL https://github.com/prometheus-operator/prometheus-operator/releases/download/${LATEST}/bundle.yaml -o bundle.yaml

# Create Prometheus ns and set perms
kubectl create ns prometheus
kubectl label --overwrite ns prometheus pod-security.kubernetes.io/enforce=baseline

# Create prometheus resources
kubectl -n prometheus create -f bundle.yaml

# Create a ServiceAccount
cat << EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: prometheus
  namespace: prometheus
EOF


# Create clusterrole
cat << EOF | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: prometheus
rules:
- apiGroups: [""]
  resources:
  - nodes
  - nodes/metrics
  - services
  - endpoints
  - pods
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources:
  - configmaps
  verbs: ["get"]
- apiGroups:
  - discovery.k8s.io
  resources:
  - endpointslices
  verbs: ["get", "list", "watch"]
- apiGroups:
  - networking.k8s.io
  resources:
  - ingresses
  verbs: ["get", "list", "watch"]
- nonResourceURLs: ["/metrics"]
  verbs: ["get"]
EOF


# Create clusterrolebinding
cat << EOF | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: prometheus
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: prometheus
subjects:
- kind: ServiceAccount
  name: prometheus
  namespace: prometheus
EOF

# Create Prometheus instance
cat << EOF | kubectl create -f -
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: prometheus
  namespace: prometheus
spec:
  serviceAccountName: prometheus
EOF


# Install alert manager
cat << EOF | kubectl create -f -
apiVersion: monitoring.coreos.com/v1
kind: Alertmanager
metadata:
  name: alertmanager
  namespace: prometheus
spec:
  replicas: 3
EOF


# Configure alert manager service
cat << EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: alertmanager-service
  namespace: prometheus
spec:
  # Changed from NodePort to ClusterIP
  type: ClusterIP
  ports:
  - name: web
    # The port the service exposes internally
    port: 9093
    protocol: TCP
    # The port the Pod is listening on
    targetPort: web
  selector:
    alertmanager: alertmanager
EOF


# Configure alertnamager monitoring
cat << EOF | kubectl apply -f -
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: monitor
  namespace: prometheus
spec:
  serviceAccountName: prometheus
  replicas: 2
  alerting:
    alertmanagers:
    - namespace: prometheus
      name: alertmanager-service
      port: web
EOF


# Create TLS secret from the keys created earlier 
kubectl create secret tls monitoring-cert \
  --cert=prom-fullchain.crt \
  --key=prom.key \
  -n prometheus

```

## Define Gateway (Contour) ##

Reference Contour gw doc:
https://projectcontour.io/docs/main/guides/gateway-api/

```
# Here we'll use Contour as an example
# But any ingress can be used

# Create a ns for the contour gw & set perms
kubectl  create ns projectcontour
kubectl label --overwrite ns projectcontour pod-security.kubernetes.io/enforce=baseline

# Create a Contour gw class
kubectl apply -f - <<EOF
kind: GatewayClass
apiVersion: gateway.networking.k8s.io/v1
metadata:
  name: contour
spec:
  controllerName: projectcontour.io/gateway-controller
EOF

# Edit and apply ingress config
kubectl apply -f prometheus-service.yaml

```

## Add a monitor service to app(s) (see example app-service-monitor.yaml) ##

```
# As we have the Prometheus operator, we'll use the Custom Resources provided by this
# We'll use 'servicemontor' to monitor the service

kubectl apply -f app-service-monitor.yaml

# The operator should discover & reconcile Prometheus 
# To check the generated config, run:

kubectl -n prometheus get secret prometheus-prometheus \
-o jsonpath='{.data.prometheus\.yaml\.gz}' | base64 -d | gzip -d
```

## Install & Configure Grafana Operator ##

```
# create ns and label for elevated permissions
kubectl create ns grafana
kubectl label --overwrite ns grafana pod-security.kubernetes.io/enforce=baseline

# install via helm
helm repo add grafana-operator https://grafana.github.io/helm-charts
helm repo update
helm install grafana-operator grafana-operator/grafana-operator \
  --namespace grafana --create-namespace


# add config
kubectl apply -f grafana-config.yaml

# use prom. as a data source for grafana
kubectl apply -f grafana-datasource-prom.yaml

# add dashboard app
kubectl apply -f grafana-dashboard-app.yaml
```

## Configure K8s Cluster Monitoring ##

Here we'll setup monitoring of the VKS cluster itself

```
# Apply the prometheus monitors

# 1. kube dns
kubectl apply -f kube-dns-monitor.yaml

# 2. kube state metrics
kubectl apply -f kube-state-metrics.yaml

# 3. kube api
kubectl apply -f kubeapi-monitor.yaml

# 4. node stats
# here we need to create a daemonset with 'node-exporter' (see https://github.com/prometheus/node_exporter)
kubectl apply -f node-exporter-daemonset.yaml

# then we create a service & servicemonitor
kubectl apply -f node-exporter-service-and-monitor.yaml

# Create the example grafana dashboards (from community sources)
kubectl apply -f grafana-dashboards-k8s.yaml
```

## Configure Logging (using Loki) ##


```
# Create a namespace for loki
kubectl create ns loki

# Set pod security
kubectl label --overwrite ns loki pod-security.kubernetes.io/enforce=baseline

# Install Loki via Helm
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
helm upgrade --install cluster-loki grafana/loki \
  -n loki \
  -f loki-values.yaml


# Install Promtail / log shipper
helm upgrade --install promtail grafana/promtail \
  --namespace loki \
  --set "config.clients[0].url=http://cluster-loki-gateway/loki/api/v1/push" \
  --set "image.registry=dockerhub.packages.vcfd.broadcom.net"


# Create grafana datasource for Loki
kubectl apply -f loki-datasource.yaml

# Import a community dashboard for Loki / K8s logs
kubectl apply -f loki-dashboard.yaml

```
