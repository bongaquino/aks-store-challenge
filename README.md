# AKS Store Demo — DevOps Challenge

Deployment of the [AKS Store Demo](https://github.com/Azure-Samples/aks-store-demo) application using Terraform, Helm, and CI/CD automation.

## Architecture

| Service | Description | Port |
|---------|-------------|------|
| store-front | Customer-facing web UI | 8080 |
| order-service | Processes orders via RabbitMQ | 3000 |
| product-service | Product catalog API | 3002 |
| rabbitmq | Message queue for orders | 5672 |

Traffic flow: **Internet → NGINX Ingress → store-front → order-service / product-service → rabbitmq**

## Prerequisites

- Azure CLI (`az`)
- Terraform >= 1.5
- Helm >= 3
- kubectl
- Docker (for local development)

## 1. Run Locally with Docker / Kubernetes

### Option A: kind (local K8s cluster)
```bash
kind create cluster --name aks-store-local
kubectl apply -f k8s/aks-store-quickstart.yaml
kubectl port-forward svc/store-front 8080:80
# Open http://localhost:8080
```

### Option B: Deploy to AKS (see section 3)

## 2. Deploy Infrastructure with Terraform
```bash
cd terraform

# Log in to Azure
az login
az account set --subscription "<your-subscription-id>"

# Deploy
terraform init
terraform plan -out=tfplan
terraform apply tfplan

# Connect kubectl
az aks get-credentials \
  --resource-group aks-store-demo-rg \
  --name aks-store-demo
```

This creates: Resource Group, ACR (Basic), AKS cluster (2 nodes), and ACR pull role assignment.

## 3. Deploy Application to Kubernetes

### Install NGINX Ingress Controller
```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

### Deploy with Helm
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
kubectl get pods,svc,ingress -n aks-store-demo
```

## 4. CI/CD Pipeline

Two pipeline definitions are provided:

- **GitHub Actions**: `.github/workflows/ci-cd.yml`
- **Azure DevOps**: `azure-pipelines.yml`

### GitHub Actions Setup

Add these repository secrets in GitHub → Settings → Secrets → Actions:

| Secret | Description |
|--------|-------------|
| `ACR_LOGIN_SERVER` | ACR login server (e.g. `myregistry.azurecr.io`) |
| `ACR_USERNAME` | ACR admin username |
| `ACR_PASSWORD` | ACR admin password |
| `AKS_CLUSTER_NAME` | AKS cluster name |
| `AKS_RESOURCE_GROUP` | Resource group name |
| `AZURE_CREDENTIALS` | Service principal JSON from `az ad sp create-for-rbac --sdk-auth` |

### Pipeline Flow

**CI** (runs on every push/PR):
1. Run unit tests per service
2. Build Docker images
3. Push to ACR (main branch only)

**CD** (runs on main branch push after CI passes):
1. Authenticate to Azure
2. Set AKS kubectl context
3. Deploy via Helm
4. Verify rollout status

## 5. Helm Chart (Bonus)

The Helm chart at `helm/aks-store/` includes:

- **Resource requests and limits** on all containers
- **Network Policies** for inter-service security:
  - Default deny-all ingress (zero trust baseline)
  - RabbitMQ: only accepts traffic from order-service on port 5672
  - Order Service: only accepts traffic from store-front on port 3000
  - Product Service: only accepts traffic from store-front on port 3002
  - Store Front: only accepts traffic from ingress-nginx namespace on port 8080
- **Configurable values** for image registry, tags, replicas, and resource limits

### Customizing

Override defaults at deploy time:
```bash
helm upgrade --install aks-store helm/aks-store \
  --set global.imageRegistry=myregistry.azurecr.io \
  --set global.imageTag=abc123 \
  --set storeFront.replicas=3
```

## Project Structure
├── k8s/
│   └── aks-store-quickstart.yaml   # Raw manifest with Ingress
├── terraform/
│   └── main.tf                     # AKS + ACR infrastructure
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
├── dockerfiles/
│   ├── order-service/Dockerfile
│   ├── product-service/Dockerfile
│   └── store-front/Dockerfile
├── .github/workflows/ci-cd.yml     # GitHub Actions pipeline
├── azure-pipelines.yml             # Azure DevOps pipeline
└── README.md

## Cleanup
```bash
helm uninstall aks-store -n aks-store-demo
helm uninstall ingress-nginx -n ingress-nginx
cd terraform && terraform destroy -auto-approve
```
