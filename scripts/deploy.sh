#!/bin/bash

# Cricket Heritage Bot AWS Deployment Script
set -e

# Configuration
ENVIRONMENT=${1:-production}
AWS_REGION=${2:-us-east-1}
STACK_NAME="cricket-bot-${ENVIRONMENT}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting deployment for environment: ${ENVIRONMENT}${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if environment variables are set
if [ -z "$BOT_TOKEN" ]; then
    echo -e "${RED}❌ BOT_TOKEN environment variable is not set.${NC}"
    exit 1
fi

if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}❌ DATABASE_URL environment variable is not set.${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Pre-deployment checks passed${NC}"

# Get AWS Account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${BLUE}📊 AWS Account ID: ${AWS_ACCOUNT_ID}${NC}"

# ECR Repository URI
ECR_REPOSITORY_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/cricket-bot-${ENVIRONMENT}"

echo -e "${YELLOW}🔧 Step 1: Deploying CloudFormation stack...${NC}"

# Deploy CloudFormation stack
aws cloudformation deploy \
    --template-file aws/cloudformation-template.yaml \
    --stack-name "${STACK_NAME}" \
    --parameter-overrides \
        Environment="${ENVIRONMENT}" \
        BotToken="${BOT_TOKEN}" \
        DatabaseUrl="${DATABASE_URL}" \
    --capabilities CAPABILITY_IAM \
    --region "${AWS_REGION}"

echo -e "${GREEN}✅ CloudFormation stack deployed successfully${NC}"

echo -e "${YELLOW}🔧 Step 2: Building Docker image...${NC}"

# Build Docker image
docker build -t cricket-bot:latest .

echo -e "${GREEN}✅ Docker image built successfully${NC}"

echo -e "${YELLOW}🔧 Step 3: Logging into ECR...${NC}"

# Login to ECR
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REPOSITORY_URI}"

echo -e "${GREEN}✅ Logged into ECR successfully${NC}"

echo -e "${YELLOW}🔧 Step 4: Tagging and pushing image to ECR...${NC}"

# Tag and push image
docker tag cricket-bot:latest "${ECR_REPOSITORY_URI}:latest"
docker push "${ECR_REPOSITORY_URI}:latest"

echo -e "${GREEN}✅ Image pushed to ECR successfully${NC}"

echo -e "${YELLOW}🔧 Step 5: Updating ECS service...${NC}"

# Update ECS service to use new image
aws ecs update-service \
    --cluster "cricket-bot-${ENVIRONMENT}-cluster" \
    --service "cricket-bot-${ENVIRONMENT}-service" \
    --force-new-deployment \
    --region "${AWS_REGION}"

echo -e "${GREEN}✅ ECS service updated successfully${NC}"

echo -e "${YELLOW}🔧 Step 6: Waiting for deployment to complete...${NC}"

# Wait for deployment to complete
aws ecs wait services-stable \
    --cluster "cricket-bot-${ENVIRONMENT}-cluster" \
    --services "cricket-bot-${ENVIRONMENT}-service" \
    --region "${AWS_REGION}"

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"

# Get service status
echo -e "${BLUE}📊 Service Status:${NC}"
aws ecs describe-services \
    --cluster "cricket-bot-${ENVIRONMENT}-cluster" \
    --services "cricket-bot-${ENVIRONMENT}-service" \
    --region "${AWS_REGION}" \
    --query 'services[0].{Status:status,RunningCount:runningCount,DesiredCount:desiredCount}' \
    --output table

echo -e "${BLUE}📊 Logs can be viewed at:${NC}"
echo -e "${BLUE}https://console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#logsV2:log-groups/log-group/\$252Fecs\$252F${ENVIRONMENT}-cricket-bot${NC}"

echo -e "${GREEN}🚀 Your Cricket Heritage Bot is now running on AWS!${NC}"
