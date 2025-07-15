#!/bin/bash

# PerceptEye Gemini Proxy Deployment Script
# This script helps deploy the proxy server to Google Cloud Run

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"secret-imprint-463805-q2"}
SERVICE_NAME=${SERVICE_NAME:-"gemini-proxy"}
REGION=${GCP_REGION:-"us-central1"}
VPC_CONNECTOR_NAME=${VPC_CONNECTOR_NAME:-"gemini-proxy-connector"}

echo -e "${BLUE}🚀 PerceptEye Gemini Proxy Deployment${NC}"
echo "=================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check dependencies
echo -e "${YELLOW}📋 Checking dependencies...${NC}"

if ! command_exists gcloud; then
    echo -e "${RED}❌ Google Cloud SDK not found. Please install it first.${NC}"
    exit 1
fi

if ! command_exists docker; then
    echo -e "${RED}❌ Docker not found. Please install it first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dependencies check passed${NC}"

# Check if user is authenticated
echo -e "${YELLOW}🔐 Checking authentication...${NC}"
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo -e "${RED}❌ Not authenticated with Google Cloud. Please run 'gcloud auth login' first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Authentication check passed${NC}"

# Set project
echo -e "${YELLOW}🏗️  Setting up project...${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "${YELLOW}🔧 Enabling required APIs...${NC}"
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    containerregistry.googleapis.com

# Build and deploy
echo -e "${YELLOW}🔨 Building and deploying...${NC}"

# Create .env file for production if it doesn't exist
if [ ! -f .env ]; then
    echo -e "${YELLOW}📝 Creating .env file...${NC}"
    cp env.example .env
    echo -e "${YELLOW}⚠️  Please update .env file with your actual values before deploying${NC}"
    read -p "Press enter to continue after updating .env file..."
fi

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check required environment variables
required_vars=(
    "SUPABASE_URL"
    "SUPABASE_ANON_KEY"
    "SUPABASE_SERVICE_ROLE"
    "GEMINI_API_KEY"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}❌ Required environment variable $var is not set${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ Environment variables check passed${NC}"

# Build and push image
echo -e "${YELLOW}📦 Building Docker image...${NC}"
docker build --platform linux/amd64 -t gcr.io/$PROJECT_ID/$SERVICE_NAME:latest .

echo -e "${YELLOW}📤 Pushing image to Container Registry...${NC}"
docker push gcr.io/$PROJECT_ID/$SERVICE_NAME:latest

# Deploy to Cloud Run
echo -e "${YELLOW}🚀 Deploying to Cloud Run...${NC}"
gcloud run deploy $SERVICE_NAME \
    --image gcr.io/$PROJECT_ID/$SERVICE_NAME:latest \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --memory 1Gi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 100 \
    --timeout 300 \
    --concurrency 80 \
    --set-env-vars "NODE_ENV=production,SUPABASE_URL=$SUPABASE_URL,SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE=$SUPABASE_SERVICE_ROLE,GEMINI_API_KEY=$GEMINI_API_KEY,REDIS_HOST=10.89.66.27,REDIS_PORT=6379" \
    --vpc-connector $VPC_CONNECTOR_NAME \
    --vpc-egress private-ranges-only

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo "=================================="
echo -e "${BLUE}Service URL: ${GREEN}$SERVICE_URL${NC}"
echo -e "${BLUE}Health Check: ${GREEN}$SERVICE_URL/health${NC}"
echo -e "${BLUE}API Documentation: ${GREEN}$SERVICE_URL/api/docs${NC}"
echo ""
echo -e "${YELLOW}📋 Next steps:${NC}"
echo "1. Test the health endpoint: curl $SERVICE_URL/health"
echo "2. Check the API documentation: curl $SERVICE_URL/api/docs"
echo "3. Update your Electron app to use this proxy URL"
echo "4. Configure your Supabase authentication in the Electron app"
echo ""
echo -e "${YELLOW}🔧 Useful commands:${NC}"
echo "- View logs: gcloud run services logs tail $SERVICE_NAME --region=$REGION"
echo "- Update service: ./deploy.sh"
echo "- Delete service: gcloud run services delete $SERVICE_NAME --region=$REGION" 