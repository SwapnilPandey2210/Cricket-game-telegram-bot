#!/bin/bash

# Quick Deploy Script for Cricket Heritage Bot
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Cricket Heritage Bot - Quick Deploy${NC}"
echo -e "${BLUE}=====================================${NC}"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️ .env file not found. Creating from template...${NC}"
    cp env.example .env
    echo -e "${RED}❌ Please edit .env file with your configuration before running this script.${NC}"
    echo -e "${BLUE}Required variables:${NC}"
    echo -e "  - BOT_TOKEN=your_telegram_bot_token"
    echo -e "  - DATABASE_URL=file:./prisma/dev.db"
    exit 1
fi

# Load environment variables
source .env

# Check required variables
if [ -z "$BOT_TOKEN" ]; then
    echo -e "${RED}❌ BOT_TOKEN is not set in .env file${NC}"
    exit 1
fi

if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}❌ DATABASE_URL is not set in .env file${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Environment variables loaded${NC}"

# Ask for deployment environment
echo -e "${BLUE}Select deployment environment:${NC}"
echo -e "1) Development"
echo -e "2) Staging"
echo -e "3) Production"
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        ENVIRONMENT="development"
        ;;
    2)
        ENVIRONMENT="staging"
        ;;
    3)
        ENVIRONMENT="production"
        ;;
    *)
        echo -e "${RED}❌ Invalid choice${NC}"
        exit 1
        ;;
esac

echo -e "${BLUE}Selected environment: ${ENVIRONMENT}${NC}"

# Ask for AWS region
read -p "Enter AWS region (default: us-east-1): " region
AWS_REGION=${region:-us-east-1}

echo -e "${BLUE}Selected region: ${AWS_REGION}${NC}"

# Confirm deployment
echo -e "${YELLOW}⚠️ About to deploy to:${NC}"
echo -e "  Environment: ${ENVIRONMENT}"
echo -e "  Region: ${AWS_REGION}"
echo -e "  Bot Token: ${BOT_TOKEN:0:10}..."
read -p "Continue? (y/N): " confirm

if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Deployment cancelled${NC}"
    exit 0
fi

# Run deployment
echo -e "${BLUE}🚀 Starting deployment...${NC}"
./scripts/deploy.sh "${ENVIRONMENT}" "${AWS_REGION}"

echo -e "${GREEN}🎉 Deployment completed!${NC}"
echo -e "${BLUE}Your bot should be running on AWS ECS.${NC}"
echo -e "${BLUE}Check the logs in AWS CloudWatch for any issues.${NC}"
