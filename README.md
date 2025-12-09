# VKS Consumption Models for Modern Applications

VMware Cloud Foundation (VCF) offers a robust foundation for managing both modern and traditional workloads. It enables unified management of VMs, Kubernetes clusters, and other resources through a single, consistent API, simplifying operations and reducing the need for separate platforms.
VCF simplifies the management of VMs and Kubernetes clusters by providing a unified, consistent API for both.

This allows for:
* Unified management – A single API manages VMs, Kubernetes clusters, and other resources, eliminating the need for separate platforms.
* Declarative API – Users define the desired state, and the system automatically configures and maintains it.
* Extensible ecosystem – Private cloud services offer additional functionality on demand while maintaining a consistent user experience.
* Infrastructure abstraction – It abstracts the complexities of the underlying infrastructure, allowing teams to focus on application delivery.
* Self-service for catalog – Consumers can deploy VMs and Kubernetes clusters on-demand through a self-service model with VCF Automation.
* Integrated services – Core services like vSphere Kubernetes Service (VKS) for clusters and VM Service for VMs are included.
* Consistent lifecycle – Building-block services have independent lifecycles, enabling flexible deployment and updates without affecting the entire environment.
* Workload isolation – vSphere Namespaces provide logical units for resource and network isolation.

The Consumption Models below are examples of how Developers and Platform Engineers can use VCF to build, run and manage modern applications with VCF provided tooling or with third party tooling.

The currently available Consumption Models are:
Continuous Integration and Delivery with Harness
Continuous Integration and Delivery with ArgoCD
Observability with Prometheus and Grafana opensource operators
