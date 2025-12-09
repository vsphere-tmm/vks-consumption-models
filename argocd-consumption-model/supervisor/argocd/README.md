For the client:

```
# download the cli
curl -sSL -o argocd-linux-amd64 \
  https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64

# move the binary 
chmod +x argocd-linux-amd64
sudo mv argocd-linux-amd64 /usr/local/bin/argocd

# login to argo
argocd login 10.163.44.37

# add cluster (k config get-contexts <-- get the vks cluster name)
argocd cluster add kubernetes-cluster-kmnr

```