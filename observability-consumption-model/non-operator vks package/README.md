### Installing Prometheus using the internal VKS package

This is the (depricated) method for installing Prometheus using the shipped VKS package (i.e. not the operator). Instead of using the CRDs, here we define custom scrape configs, etc. 

Included here for reference.

## Install Contour with Envoy ##

```
# get available versions
vcf package available get contour.kubernetes.vmware.com -n packages

# install
vcf package install contour -p contour.kubernetes.vmware.com --version 1.32.0+vmware.1-vks.1 --values-file contour-data-values.yaml -n packages
```

## Create a DNS A Record ##

```
# from the envoy external address, point it to prom, eg
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


## Install Prometheus ##

```
# get available versions
vcf package available get prometheus.tanzu.vmware.com -n packages

# get the default values file for the version, for example
vcf package available get prometheus.kubernetes.vmware.com/3.5.0+vmware.1-vks.1 -n packages --default-values-file-output default-prometheus-data-values.yaml

# edit this file to include the cert values and scrape config (see example prometheus-data-values.yaml)

# install
vcf package install prometheus -p prometheus.kubernetes.vmware.com --version 3.5.0+vmware.1-vks.1 --values-file prometheus-data-values.yaml -n packages

# get the external address from envoy
kubectl -n tanzu-system-ingress get svc envoy

```


## Add a monitor service to app(s) (see example monitor-service.yaml) ##

```
# We add three annotations to the app service which prometheus will pick up:
#  annotations:
#    prometheus.io/scrape: "true"
#    prometheus.io/port: <port>
#    prometheus.io/path: <metrics path>

kubectl apply -f monitor-service.yaml
```

## Install & Configure Grafana Operator ##

```
# create ns and label for elevated permissions
kubectl create ns grafana
kubectl label --overwrite ns grafana pod-security.kubernetes.io/enforce=baseline
kubectl label --overwrite ns grafana pod-security.kubernetes.io/enforce=privileged

# install via helm
helm repo add grafana-operator https://grafana.github.io/helm-charts
helm repo update
helm install grafana-operator grafana-operator/grafana-operator \
  --namespace grafana --create-namespace


# add config
kubectl apply -f grafana-config.yaml

# use prom. as a data source for grafana
kubectl apply -f grafana-datasource-prom.yaml

# add dashboard
kubectl apply -f grafana-dashboard-app.yaml