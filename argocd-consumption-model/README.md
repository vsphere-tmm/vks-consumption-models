# Argo CD Consumption Model: End-to-End GitOps on VKS

This repository provides a complete framework for deploying and managing the **Google Microservices Demo** (Online Boutique) on **vSphere Kubernetes Service (VKS)**. 

It demonstrates a robust enterprise CI/CD pattern using **GitLab** for orchestration and **Argo CD** for GitOps.

---

## System Architecture

The workflow integrates infrastructure services, automated pipelines, and declarative continuous delivery:

1.  **Platform Services:** The Supervisor cluster handles core services (Argo CD, Harbor )
2.  **Continuous Integration (GitLab):** A GitLab Runner builds images from source and updates the helm manifests.
3.  **GitOps (Argo CD):** Argo CD monitors the Helm repository and synchronizes the VKS cluster state.
4.  **Infrastructure:** **VKS Kubernetes cluster** by **VMware Cloud Foundation (VCF)**.


---

## Repository Structure

The project is organized into four functional areas:

### 1. `supervisor/`
Contains the core infrastructure components installed as **vSphere Supervisor Services** or packages.
* **argocd:** The GitOps controller for application delivery.
* **harbor:** Enterprise-grade container registry for storing microservice images.
* **contour:** Ingress controller for managing external access to the Supervisor services.
* **kubernetes-service:** Manifests package repository file for the target VKS cluster.

### 2. `pipelines/`
Contains the CI logic.
* **.gitlab-ci.yml:** The pipeline definition that orchestrates the building, testing, and manifest-updating process for the microservices.

### 3. `gitlab/`
Contains the deployment logic for the CI infrastructure itself.
* **gitlab-operator:** Helm-based installation of Gitlab instance in **VKS** cluster.
* **gitlab-runner:** Helm-based installation details for deploying runners into the cluster to execute the CI jobs.

### 4. `certs/`
A centralized directory for security and trust.
* Contains the **certificate chain** and related details required to ensure secure TLS communication between GitLab, the Harbor registry, and the Kubernetes API.



---

## Getting Started

### 1. Set Up Gitlab

* Navigate to the `gitlab/` directory in the `vks-consumption-models/argocd-consumption-model/` directory.
* Follow the instructions provided there to deploy and configure your GitLab instance.
* **Clone** the following repositories into your new GitLab instance:

    [microservice-demo](https://github.com/vsphere-tmm/microservice-demo.git)
     
    [helm-charts-demo](https://github.com/vsphere-tmm/helm-charts-demo.git)


### 2. Configure the CI Pipeline
To enable the GitLab Runner to build your code, you must manually move and configure the pipeline file:

*  Locate the `.gitlab-ci.yml` file within the `vks-consumption-models/argocd-consumption-model/` directory.
*  **Copy** this file to the root of your cloned **microservice-demo** repository in GitLab.
*  **Modify** the `.gitlab-ci.yml` file to match your environment:
    * Update `tags` to match your registered GitLab Runner’s tag.
    * Update `HARBOR_URL` or `REGISTRY_URL` to point to your image registry.
    * Update the `HELM_REPO_URL` to point to the `helm-charts-demo` repo in your GitLab instance.


### 3. Update Helm Values (`values.yaml`)
In your **helm-charts-demo** repository, you must point the deployment to your specific image registry. Edit the `values.yaml` file:

```yaml
images:
  # Replace with your Harbor / Registry project path
  repository: quay.io/rahulk10/microservice-demo 
  
  # Note: The GitLab CI job will automatically overwrite this tag during a build
  tag: "7K3NqVRXTHGAbfTi70P30w"
```

### 4. Bootstrap Argo CD
To start the automated deployment, you must apply the Root Application manifest. This manifest acts as the "bridge" that tells Argo CD to monitor your GitLab repository for the Helm chart updates triggered by your CI pipeline.

```yaml
kubectl apply -f argocd-consumption-model/argocd-apps/microservices-demo.yaml
```

---

## About the Application
The **Google Microservices Demo** is a 11-tier microservices application consisting of:
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

## Key Benefits
* **Self-Hosted GitOps** Complete control over the CI/CD environment using the provided GitLab setup.
* **Automated Updates:** GitLab CI handles the heavy lifting of updating image tags in Helm.
* **Supervisor Services Integrated:** Built specifically to leverage Supervisor Services.
