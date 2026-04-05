# AKS Store Demo — DevOps Challenge

Deployment of the [AKS Store Demo](https://github.com/Azure-Samples/aks-store-demo) application to Azure Kubernetes Service (AKS) using Terraform, Helm, and CI/CD automation.

> **Note:** Per challenge guidelines, source code from the AKS Demo repository is not included. This repo contains only the infrastructure, Kubernetes manifests, Helm chart, CI/CD pipelines, and Dockerfiles needed to build and deploy the application.

## Architecture

| Service | Description | Port |
|---------|-------------|------|
| store-front | Customer-facing web UI (Vue.js) | 8080 |
| order-service | Order processing API (Node.js/Fastify) | 3000 |
| product-service | Product catalog API (Node.js) | 3002 |
| rabbitmq | Message queue for order processing | 5672 |

Traffic flow: **Internet → NGINX Ingress Controller → store-front → order-service / product-service → RabbitMQ**

## Prerequisites

- Azure CLI (`az`) with an active subscription
- Terraform >= 1.5
- Helm >= 3
- kubectl
- Docker (for local development)

## 1. Run Locally

### Option A: kind (local Kubernetes cluster)
```bash
kind create cluster --name aks-store-local

# Install NGINX Ingress for kind
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

# Deploy the app
kubectl create namespace aks-store-demo
kubectl apply -f k8s/aks-store-quickstart.yaml -n aks-store-demo

# Port-forward to access the store
kubectl port-forward svc/store-front 8080:80 -n aks-store-demo
# Open http://localhost:8080
```

### Option B: Docker Compose (using upstream source)

Clone the original AKS Store Demo repo and run with Docker Compose:
```bash
git clone https://github.com/Azure-Samples/aks-store-demo.git
cd aks-store-demo
docker compose up
# Open http://localhost:8080
```

## 2. Deploy Infrastructure with Terraform

The Terraform configuration creates four resources in Azure:

| Resource | Purpose |
|----------|---------|
| Resource Group | Logical container (`aks-store-demo-rg`) |
| Azure Container Registry | Private Docker image registry (Basic SKU) |
| AKS Cluster | 2-node Kubernetes cluster (`Standard_B2pls_v2` in `westus2`) |
| Role Assignment | Grants AKS permission to pull images from ACR |

> **Note:** The ACR name must be globally unique. Change the `acr_name` variable in `terraform/main.tf` if the default is taken.

> **Note:** Azure free-tier subscriptions restrict VM SKUs by region. `Standard_B2pls_v2` in `westus2` was selected because `Standard_B2s` was unavailable in `eastus`. Run `az vm list-skus --location <region> --resource-type virtualMachines` to check availability in your region.
```bash
cd terraform

# Log in to Azure
az login
az account set --subscription "<your-subscription-id>"

# Deploy infrastructure (~6 minutes)
terraform init
terraform plan -out=tfplan
terraform apply tfplan

# Connect kubectl to the new cluster
az aks get-credentials \
  --resource-group aks-store-demo-rg \
  --name aks-store-demo

# Verify nodes are ready
kubectl get nodes
```

## 3. Deploy Application to Kubernetes

### Install NGINX Ingress Controller
```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# Wait for external IP
kubectl get svc -n ingress-nginx --watch
```

### Deploy with Helm (recommended)
```bash
helm upgrade --install aks-store helm/aks-store \
  --namespace aks-store-demo \
  --create-namespace \
  --wait --timeout 5m
```

### Deploy with kubectl (alternative)
```bash
kubectl create namespace aks-store-demo
kubectl apply -f k8s/aks-store-quickstart.yaml -n aks-store-demo
```

### Verify
```bash
kubectl get pods,svc,ingress,networkpolicies -n aks-store-demo
```

Open the Ingress external IP in your browser to see the store.

## 4. CI/CD Pipeline

Two pipeline definitions are provided:

- **GitHub Actions**: `.github/workflows/ci-cd.yml`
- **Azure DevOps**: `azure-pipelines.yml`

> **Note:** The CI/CD pipeline is set to `workflow_dispatch` (manual trigger) because this repo does not contain the application source code (`src/` directory). The pipeline is structurally complete and will execute successfully once source code is added to `src/order-service`, `src/product-service`, and `src/store-front`.

### GitHub Actions Setup

Add these repository secrets in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `ACR_LOGIN_SERVER` | ACR login server (e.g. `myregistry.azurecr.io`) |
| `ACR_USERNAME` | ACR admin username |
| `ACR_PASSWORD` | ACR admin password |
| `AKS_CLUSTER_NAME` | AKS cluster name |
| `AKS_RESOURCE_GROUP` | Resource group name |
| `AZURE_CREDENTIALS` | Service principal JSON from `az ad sp create-for-rbac --sdk-auth` |

### Pipeline Flow

**CI** (runs per service in parallel via matrix strategy):
1. Run unit tests (npm test / pytest)
2. Build Docker image tagged with commit SHA
3. Push to ACR (main branch only)

**CD** (runs on main after CI passes):
1. Authenticate to Azure via service principal
2. Set AKS kubectl context
3. Deploy via `helm upgrade --install`
4. Verify rollout status of all deployments

## 5. Helm Chart (Bonus)

The Helm chart at `helm/aks-store/` includes:

- **Resource requests and limits** on all containers (CPU and memory)
- **Network Policies** implementing zero-trust inter-service security:
  - Default deny-all ingress (baseline)
  - RabbitMQ: only accepts traffic from order-service on port 5672
  - Order Service: only accepts traffic from store-front on port 3000
  - Product Service: only accepts traffic from store-front on port 3002
  - Store Front: only accepts traffic from ingress-nginx namespace on port 8080
- **Configurable values** for image registry, tags, replicas, and resource limits

### Override defaults at deploy time
```bash
helm upgrade --install aks-store helm/aks-store \
  --set global.imageRegistry=myregistry.azurecr.io \
  --set global.imageTag=abc123 \
  --set storeFront.replicas=3
```

## 6. Dockerfiles

Template Dockerfiles are provided in `dockerfiles/` for each service. These are designed to work with the application source code from the [AKS Store Demo](https://github.com/Azure-Samples/aks-store-demo) repo:

- `dockerfiles/order-service/Dockerfile` — Node.js service
- `dockerfiles/product-service/Dockerfile` — Node.js service
- `dockerfiles/store-front/Dockerfile` — Multi-stage build (Node.js build → NGINX serve)

> **Note:** The store-front Dockerfile expects an `nginx.conf` in the source directory. A sample config should map port 8080 and serve the built static files.

## Project Structure

```
├── .github/workflows/
│   └── ci-cd.yml                   # GitHub Actions CI/CD (manual trigger)
├── .gitignore
├── azure-pipelines.yml             # Azure DevOps CI/CD pipeline
├── dockerfiles/
│   ├── order-service/Dockerfile
│   ├── product-service/Dockerfile
│   └── store-front/Dockerfile
├── helm/aks-store/
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
│       ├── rabbitmq.yaml
│       ├── order-service.yaml
│       ├── product-service.yaml
│       ├── store-front.yaml
│       ├── ingress.yaml
│       └── network-policies.yaml
├── k8s/
│   └── aks-store-quickstart.yaml   # Raw K8s manifest with Ingress
├── terraform/
│   └── main.tf                     # AKS + ACR infrastructure
└── README.md
```

## Cleanup
```bash
# Remove app and ingress controller
helm uninstall aks-store -n aks-store-demo
helm uninstall ingress-nginx -n ingress-nginx

# Destroy all Azure resources
cd terraform
terraform destroy -auto-approve
```
