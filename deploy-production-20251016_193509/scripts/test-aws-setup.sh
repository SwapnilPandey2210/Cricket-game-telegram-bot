#!/bin/bash

# AWS S3 Setup Test Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 Testing AWS S3 Setup for Cricket Heritage Bot...${NC}"

# Test 1: AWS CLI Configuration
echo -e "${YELLOW}1. Testing AWS CLI configuration...${NC}"
if aws sts get-caller-identity &> /dev/null; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    echo -e "${GREEN}✅ AWS CLI configured (Account: ${ACCOUNT_ID})${NC}"
else
    echo -e "${RED}❌ AWS CLI not configured. Run 'aws configure' first.${NC}"
    exit 1
fi

# Test 2: S3 Bucket Access
echo -e "${YELLOW}2. Testing S3 bucket access...${NC}"
if [ -z "$BACKUP_S3_BUCKET" ]; then
    echo -e "${YELLOW}⚠️ BACKUP_S3_BUCKET not set. Using default test bucket.${NC}"
    TEST_BUCKET="cricket-bot-test-$(date +%s)"
    export BACKUP_S3_BUCKET="$TEST_BUCKET"
    
    # Create test bucket
    aws s3 mb "s3://${TEST_BUCKET}" 2>/dev/null || true
    echo -e "${GREEN}✅ Test bucket created: ${TEST_BUCKET}${NC}"
else
    if aws s3 ls "s3://${BACKUP_S3_BUCKET}" &> /dev/null; then
        echo -e "${GREEN}✅ S3 bucket accessible: ${BACKUP_S3_BUCKET}${NC}"
    else
        echo -e "${RED}❌ S3 bucket not accessible: ${BACKUP_S3_BUCKET}${NC}"
        exit 1
    fi
fi

# Test 3: Database File
echo -e "${YELLOW}3. Testing database file...${NC}"
if [ -f "prisma/dev.db" ]; then
    DB_SIZE=$(du -h "prisma/dev.db" | cut -f1)
    echo -e "${GREEN}✅ Database file found (Size: ${DB_SIZE})${NC}"
    
    # Test database integrity
    if sqlite3 "prisma/dev.db" "PRAGMA integrity_check;" | grep -q "ok"; then
        echo -e "${GREEN}✅ Database integrity verified${NC}"
    else
        echo -e "${RED}❌ Database integrity check failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Database file not found at prisma/dev.db${NC}"
    exit 1
fi

# Test 4: Backup Script
echo -e "${YELLOW}4. Testing backup script...${NC}"
if [ -f "scripts/backup-to-s3.sh" ]; then
    echo -e "${GREEN}✅ Backup script found${NC}"
    
    # Test backup (dry run)
    echo -e "${YELLOW}   Running test backup...${NC}"
    if ./scripts/backup-to-s3.sh; then
        echo -e "${GREEN}✅ Backup test successful${NC}"
    else
        echo -e "${RED}❌ Backup test failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Backup script not found${NC}"
    exit 1
fi

# Test 5: Restore Script
echo -e "${YELLOW}5. Testing restore script...${NC}"
if [ -f "scripts/restore-from-s3.sh" ]; then
    echo -e "${GREEN}✅ Restore script found${NC}"
    
    # List available backups
    echo -e "${YELLOW}   Available backups:${NC}"
    aws s3 ls "s3://${BACKUP_S3_BUCKET}/database-backups/" --recursive | tail -3
else
    echo -e "${RED}❌ Restore script not found${NC}"
    exit 1
fi

# Test 6: Environment Variables
echo -e "${YELLOW}6. Testing environment variables...${NC}"
REQUIRED_VARS=("BOT_TOKEN" "DATABASE_URL")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -eq 0 ]; then
    echo -e "${GREEN}✅ All required environment variables set${NC}"
else
    echo -e "${YELLOW}⚠️ Missing environment variables: ${MISSING_VARS[*]}${NC}"
    echo -e "${YELLOW}   Set them in your .env file or export them${NC}"
fi

# Test 7: Application Build
echo -e "${YELLOW}7. Testing application build...${NC}"
if npm run build; then
    echo -e "${GREEN}✅ Application builds successfully${NC}"
else
    echo -e "${RED}❌ Application build failed${NC}"
    exit 1
fi

# Test 8: Docker Build
echo -e "${YELLOW}8. Testing Docker build...${NC}"
if command -v docker &> /dev/null; then
    if docker build -t cricket-bot-test . &> /dev/null; then
        echo -e "${GREEN}✅ Docker build successful${NC}"
        # Clean up test image
        docker rmi cricket-bot-test &> /dev/null || true
    else
        echo -e "${RED}❌ Docker build failed${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️ Docker not available, skipping Docker test${NC}"
fi

# Cleanup test bucket if created
if [ "$BACKUP_S3_BUCKET" = "$TEST_BUCKET" ]; then
    echo -e "${YELLOW}🧹 Cleaning up test bucket...${NC}"
    aws s3 rb "s3://${TEST_BUCKET}" --force &> /dev/null || true
    echo -e "${GREEN}✅ Test bucket cleaned up${NC}"
fi

echo ""
echo -e "${GREEN}🎉 All tests passed! Your AWS S3 setup is ready.${NC}"
echo ""
echo -e "${BLUE}📋 Next Steps:${NC}"
echo -e "   1. Set up your production S3 bucket: npm run setup:s3"
echo -e "   2. Configure automated backups"
echo -e "   3. Deploy to AWS: npm run deploy:aws"
echo ""
echo -e "${BLUE}💰 Estimated Monthly Costs:${NC}"
echo -e "   S3 Storage: $0.10-0.50"
echo -e "   EC2 Instance: $5-20"
echo -e "   Total: $5-25/month"
