#!/bin/bash

# Complete AWS Deployment Script for Cricket Heritage Bot
set -e

# Configuration
ENVIRONMENT=${1:-"production"}
REGION=${2:-"us-east-1"}
BUCKET_NAME=${3:-"cricket-heritage-bot-backups-$(date +%s)"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Deploying Cricket Heritage Bot to AWS...${NC}"
echo -e "${BLUE}   Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}   Region: ${REGION}${NC}"
echo -e "${BLUE}   S3 Bucket: ${BUCKET_NAME}${NC}"

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Please install AWS CLI first.${NC}"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured. Please run 'aws configure' first.${NC}"
    exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found. Please install Docker first.${NC}"
    exit 1
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All prerequisites met${NC}"

# Step 1: Setup S3
echo -e "${YELLOW}📦 Setting up S3 bucket...${NC}"
./scripts/setup-s3.sh "$BUCKET_NAME" "$REGION"

# Step 2: Update environment variables
echo -e "${YELLOW}⚙️ Updating environment variables...${NC}"

# Create production .env file
cat > .env.production << EOF
# Telegram Bot Configuration
BOT_TOKEN=${BOT_TOKEN}

# Database Configuration
DATABASE_URL=file:./prisma/dev.db

# Environment
NODE_ENV=production

# AWS Configuration
AWS_REGION=${REGION}
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# S3 Backup Configuration
BACKUP_S3_BUCKET=${BUCKET_NAME}
BACKUP_SCHEDULE=0 2 * * *  # Daily at 2 AM UTC
EOF

echo -e "${GREEN}✅ Environment variables configured${NC}"

# Step 3: Build application
echo -e "${YELLOW}🔨 Building application...${NC}"
npm install
npm run build

echo -e "${GREEN}✅ Application built successfully${NC}"

# Step 4: Create Docker image
echo -e "${YELLOW}🐳 Building Docker image...${NC}"
docker build -t cricket-heritage-bot:latest .

echo -e "${GREEN}✅ Docker image built successfully${NC}"

# Step 5: Test backup functionality
echo -e "${YELLOW}🧪 Testing backup functionality...${NC}"
export BACKUP_S3_BUCKET="$BUCKET_NAME"
./scripts/backup-to-s3.sh

echo -e "${GREEN}✅ Backup functionality tested${NC}"

# Step 6: Create deployment package
echo -e "${YELLOW}📦 Creating deployment package...${NC}"

DEPLOY_DIR="deploy-${ENVIRONMENT}-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$DEPLOY_DIR"

# Copy necessary files
cp -r dist "$DEPLOY_DIR/"
cp -r prisma "$DEPLOY_DIR/"
cp -r scripts "$DEPLOY_DIR/"
cp package.json "$DEPLOY_DIR/"
cp package-lock.json "$DEPLOY_DIR/"
cp Dockerfile "$DEPLOY_DIR/"
cp .env.production "$DEPLOY_DIR/.env"

# Create deployment info
cat > "$DEPLOY_DIR/deployment-info.txt" << EOF
Cricket Heritage Bot Deployment
===============================
Environment: ${ENVIRONMENT}
Region: ${REGION}
S3 Bucket: ${BUCKET_NAME}
Deployment Date: $(date)
AWS Account: $(aws sts get-caller-identity --query Account --output text)
EOF

echo -e "${GREEN}✅ Deployment package created: ${DEPLOY_DIR}${NC}"

# Step 7: Create startup script
cat > "$DEPLOY_DIR/start.sh" << 'EOF'
#!/bin/bash
set -e

echo "🚀 Starting Cricket Heritage Bot..."

# Wait for database to be ready
while [ ! -f "prisma/dev.db" ]; do
    echo "⏳ Waiting for database..."
    sleep 5
done

# Run database migrations
echo "🔄 Running database migrations..."
npx prisma migrate deploy

# Start the application
echo "🎯 Starting bot application..."
npm start
EOF

chmod +x "$DEPLOY_DIR/start.sh"

# Step 8: Create monitoring script
cat > "$DEPLOY_DIR/monitor.sh" << 'EOF'
#!/bin/bash

# Simple health check script
while true; do
    if pgrep -f "node.*dist/index.js" > /dev/null; then
        echo "$(date): Bot is running"
    else
        echo "$(date): Bot is not running - restarting..."
        ./start.sh &
    fi
    sleep 60
done
EOF

chmod +x "$DEPLOY_DIR/monitor.sh"

# Step 9: Create backup cron job
cat > "$DEPLOY_DIR/backup-cron.sh" << EOF
#!/bin/bash
# Daily backup script
cd "$(dirname "$0")"
export BACKUP_S3_BUCKET="${BUCKET_NAME}"
./scripts/backup-to-s3.sh
EOF

chmod +x "$DEPLOY_DIR/backup-cron.sh"

echo -e "${GREEN}🎉 AWS deployment preparation completed!${NC}"
echo ""
echo -e "${BLUE}📋 Deployment Summary:${NC}"
echo -e "   Environment: ${ENVIRONMENT}"
echo -e "   Region: ${REGION}"
echo -e "   S3 Bucket: ${BUCKET_NAME}"
echo -e "   Deployment Package: ${DEPLOY_DIR}"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo -e "   1. Upload ${DEPLOY_DIR} to your server"
echo -e "   2. Run: cd ${DEPLOY_DIR} && ./start.sh"
echo -e "   3. Set up cron job for backups: 0 2 * * * ${DEPLOY_DIR}/backup-cron.sh"
echo -e "   4. Monitor with: ${DEPLOY_DIR}/monitor.sh"
echo ""
echo -e "${BLUE}💰 Estimated Monthly Costs:${NC}"
echo -e "   S3 Storage: ~$0.10-0.50"
echo -e "   EC2 Instance: ~$5-20 (depending on size)"
echo -e "   Total: ~$5-25/month"
echo ""
echo -e "${GREEN}🎯 Your bot is ready for AWS deployment!${NC}"
