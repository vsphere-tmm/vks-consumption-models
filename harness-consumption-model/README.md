# Harness CI/CD Pipeline for Modern Microservices Application

This repository contains a **Harness CI/CD pipeline** for building, and deploying a modern microservices-based application. The pipeline automates Docker image creation, pushing to a artifactory container registry, updating Helm charts, and rolling out deployments to VKS Kubernetes cluster.

---

## Prerequisites & Setup

Before you start, you must configure a few things in your environment and your Harness Account.

### Fork the Following Repositories


| Repository Name        | Purpose                                                          | GitHub URL                                              |
|------------------------|------------------------------------------------------------------|---------------------------------------------------------|
| microservice-demo    | Contains the microservices source code and Dockerfiles.          | [https://github.com/rahulk010/microservice-demo.git](https://github.com/rahulk010/microservice-demo.git) |
| helm-charts            | Contains the Helm chart templates and values.yaml files for deployment. | [https://github.com/rahulk010/helm-charts.git](https://github.com/rahulk010/helm-charts.git)             |

> **Note:** After forking these repositories, remember to use your own repository URLs in the Harness pipeline configuration.


### Kubernetes Delegate Setup

To allow Harness SaaS to connect to your `vks-cluster`, you need to install the **Harness Delegate** in your Kubernetes cluster. The Delegate is responsible for performing various tasks like building, deploying, and managing services.

You can install the Delegate using **Helm**, which is the recommended method for deployment. Here’s the Helm command to install the Delegate:

### Helm Command Example

```bash
kubectl create namespace harness-delegate-ng

kubectl label ns --overwrite harness-delegate-ng pod-security.kubernetes.io/audit=privileged,pod-security.kubernetes.io/enforce=privileged,pod-security.kubernetes.io/warn=privileged

helm upgrade -i helm-delegate --namespace harness-delegate-ng \
  harness-delegate/harness-delegate-ng \
  --set delegateName=helm-delegate \
  --set accountId=axs4qKS3SYmPeIACSysCuA \
  --set delegateToken=NjBiNzA0MDE3OWVlYjlmMWQ1ZjViMTNhZjI1YjA3ZGQ= \
  --set managerEndpoint=https://app.harness.io \
  --set delegateDockerImage=us-docker.pkg.dev/gar-prod-setup/harness-public/harness/delegate:25.10.87101 \
  --set replicas=1 --set upgrader.enabled=true
```
**Note:** Replace the `accountId` and `delegateToken` with the values from your Harness account. You can get the token from your Harness account by following: [Install a Harness Delegate](https://developer.harness.io/docs/platform/get-started/tutorials/install-delegate/).


### Explanation of the Helm Command

* helm upgrade -i helm-delegate: Installs or upgrades the Harness Delegate with the name helm-delegate in the harness-delegate-ng namespace.
* --set delegateName=helm-delegate: Sets the name of the delegate to helm-delegate.
* --set accountId=axs4qKS3SYmPeIACSysCuA: Specifies your Harness account ID.
* --set delegateToken=NjBiNzA0MDE3OWVlYjlmMWQ1ZjViMTNhZjI1YjA3ZGQ=: This is your delegate token, which can be retrieved from the Harness UI (ensure to replace it with your actual token).
* --set managerEndpoint=https://app.harness.io: Points to the Harness SaaS instance endpoint.
* --set delegateDockerImage=us-docker.pkg.dev/gar-prod-setup/harness-public/harness/delegate:25.10.87101: Specifies the version of the Harness Delegate Docker image to use.
* --set replicas=1: Deploys a single instance of the Delegate. You can scale this as needed.
* --set upgrader.enabled=true: Enables automatic upgrades for the Delegate.


### Installation Notes

1. Install the Helm chart with the command above to set up the Harness Delegate in your Kubernetes cluster.
2. After installing the Delegate, you should be able to link the Kubernetes cluster to Harness by using the Kubernetes Connector (harnessk8sconnector).
3. If you wish to scale the number of Delegate replicas, you can modify the replicas value in the Helm command accordingly.

### Configure Harness Connectors

Connectors are secure, configurable integrations that allow Harness to communicate with external systems such as GitHub, Artifactory, Docker registries, and the VKS cluster. They securely store credentials—such as tokens, usernames/passwords, and API-keys within Harness Secret Management. This eliminates the need to hard-code sensitive information directly into the pipeline YAML.

Create the following connectors in your Harness project using the exact names defined in the pipeline configuration. If you prefer to use different connector names, be sure to update the pipeline code wherever these connectors are referenced.

1. **GitHub Connector** – `rkgithubconnector`  
   **Note:** When creating the GitHub connector, **tick "Enable API access"** (recommended), as it's needed by Harness to interact with the GitHub API.  
   [Harness GitHub Connector Documentation](https://developer.harness.io/docs/platform/connectors/code-repositories/connect-to-code-repo/)

2. **Artifactory Docker Registry Connector** – `artifactorydockerconnector`  
   [Harness Docker Registry Connector Documentation](https://developer.harness.io/docs/platform/connectors/cloud-providers/ref-cloud-providers/docker-registry-connector-settings-reference/)

3. **Kubernetes Connector** – `harnessk8sconnector`  
   [Harness Kubernetes Connector Documentation](https://developer.harness.io/docs/platform/connectors/cloud-providers/add-a-kubernetes-cluster-connector/)


### Taget Environment References

These reference are used in the Deployment Stage:

1. **Service Reference** – `appdeployservice`  
   [Harness Service Reference Documentation](https://developer.harness.io/docs/continuous-delivery/x-platform-cd-features/services/services-overview/)

2. **Environment Reference** – `prodenv`  
   [Harness Environment Reference Documentation](https://developer.harness.io/docs/continuous-delivery/x-platform-cd-features/environments/environment-overview/)


> **Note:** If you choose to create environment references with different names, you must update the pipeline YAML accordingly before running the pipeline.

### Redis Image Dependency for Cartservice

- The **cartservice** microservice depends on a Redis pod, but **does not include a Dockerfile for Redis** itself.
- Therefore, you must have a `redis:latest` image available in your Artifactory registry before deploying the application.
- Ensure this dependency is met, since the Helm charts expect to pull `redis:latest` from Artifactory; without it, the cartservice deployment will fail.  

---
### VKS Cluster Configuration for Ephemeral Storage

When using a VKS cluster to build Docker images and deploy workloads through Harness, it’s important to ensure that each worker node has sufficient **storage** under **/var/lib/containerd**. Refer [Considerations for Using Node Volume Mounts
](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vsphere-supervisor-services-and-standalone-components/latest/managing-vsphere-kuberenetes-service-clusters-and-workloads/managing-storage-for-tkg-service-clusters/considerations-for-using-node-volume-mounts.html)

Harness CI build pods temporarily store Docker layers and build artifacts on this path, and if the disk space is insufficient, the pods may get evicted due to NodeDiskPressure.

### Kubernetes Namespace & Pod‑Security Configuration

- Harnessd deploys the **build** pods in the `build` namespace, and the application is deployed in the `demo-app` namespace. Build pods are used to run the CI jobs—including compiling code, running tests, building Docker images, and pushing them to the registry.
- You must add the following labels to **both** namespaces to allow privileged workloads and deployments:  

```
pod-security.kubernetes.io/audit=privileged,pod-security.kubernetes.io/enforce=privileged,pod-security.kubernetes.io/warn=privileged

Example:

kubectl label ns --overwrite build pod-security.kubernetes.io/audit=privileged,pod-security.kubernetes.io/enforce=privileged,pod-security.kubernetes.io/warn=privileged

kubectl label ns --overwrite demo-app pod-security.kubernetes.io/audit=privileged,pod-security.kubernetes.io/enforce=privileged,pod-security.kubernetes.io/warn=privileged
```


---

## How to Run the Pipeline

Once the prerequisities are complete, you can copy the pipeline code and run the pipeline.

---

## Step 1: Import the Pipeline

1. Navigate to the **Pipelines** section of your Harness project (**test-cd-app**).
2. Create a new pipeline named **cicd-pipeline**, select the **Inline** option, and click **Start**.
3. Switch to the **YAML** view, paste the contents of `cicd-pipeline.yaml`, and save the pipeline.
4. Ensure that all connector names in the YAML match the connectors created during the prerequisites.

---

## Step 2: Trigger the Pipeline

1. Open the **cicd-pipeline** and click **Run**.
2. The pipeline will execute the following two stages:

---

### Stage 1: Build and Push (CI)

- Clone the **microservice-demo** repository from GitHub.
- Execute a shell script to prepend the passthrough repository prefix to all microservice Dockerfiles.
- Build Docker images for all services, tagging them with the pipeline execution ID.
- Push the newly built images to the **Artifactory Docker registry**.
- Update the Helm chart values file (`values-vks-agents.yaml`) with the new image tags and commit the changes back to the **helm-charts** GitHub repository.


**Microservices built:**
- `adservice`
- `cartservice`
- `checkoutservice`
- `currencyservice`
- `emailservice`
- `frontend`
- `loadgenerator`
- `paymentservice`
- `productcatalogservice`
- `recommendationservice`
- `shippingservice`
- `shoppingassistantservice`


---

### Stage 2: Deploy (CD)

- Harness checks out the Helm charts from the GitHub repository.
- The deployment targets the **prodenv** environment and the **vkscluster** infrastructure.
- A **Rolling Deployment** is performed on the VKS cluster using the updated images stored in Artifactory.
- If any issue occurs, an automatic rollback strategy is triggered to restore the previous stable state.

---

### Step 3: Monitor

Monitor the pipeline execution through the Harness UI. In the event of a deployment failure, Harness will automatically roll back to the last known good state.

---

## References

- [Harness Documentation](https://docs.harness.io/)
- [Quay.io Documentation](https://quay.io/)
- [Kubernetes Rolling Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Helm Charts](https://helm.sh/docs/)

---



