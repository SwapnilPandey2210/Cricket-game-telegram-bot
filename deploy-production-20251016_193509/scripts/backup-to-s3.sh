#!/bin/bash

# Enhanced Database Backup Script with S3 Integration
set -e

# Configuration
BACKUP_DIR="/tmp/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="cricket_bot_backup_${TIMESTAMP}.db"
S3_BUCKET=${BACKUP_S3_BUCKET:-"cricket-heritage-bot-backups"}
AWS_REGION=${AWS_REGION:-"us-east-1"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🗄️ Starting enhanced database backup to S3...${NC}"

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

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Check if database file exists
if [ ! -f "prisma/dev.db" ]; then
    echo -e "${RED}❌ Database file not found at prisma/dev.db${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Creating backup...${NC}"

# Create backup with integrity check
cp "prisma/dev.db" "${BACKUP_DIR}/${BACKUP_FILE}"

# Verify backup integrity
if ! sqlite3 "${BACKUP_DIR}/${BACKUP_FILE}" "PRAGMA integrity_check;" | grep -q "ok"; then
    echo -e "${RED}❌ Backup integrity check failed${NC}"
    rm "${BACKUP_DIR}/${BACKUP_FILE}"
    exit 1
fi

echo -e "${GREEN}✅ Backup integrity verified${NC}"

# Compress backup
gzip "${BACKUP_DIR}/${BACKUP_FILE}"
BACKUP_FILE="${BACKUP_FILE}.gz"

echo -e "${GREEN}✅ Backup created and compressed: ${BACKUP_DIR}/${BACKUP_FILE}${NC}"

# Get backup size
BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
echo -e "${BLUE}📊 Backup size: ${BACKUP_SIZE}${NC}"

# Upload to S3
echo -e "${YELLOW}☁️ Uploading to S3...${NC}"

# Check if bucket exists
if ! aws s3 ls "s3://${S3_BUCKET}" &> /dev/null; then
    echo -e "${RED}❌ S3 bucket '${S3_BUCKET}' does not exist or is not accessible${NC}"
    echo -e "${YELLOW}💡 Run './scripts/setup-s3.sh' to create the bucket${NC}"
    exit 1
fi

# Upload with metadata
aws s3 cp "${BACKUP_DIR}/${BACKUP_FILE}" \
    "s3://${S3_BUCKET}/database-backups/${BACKUP_FILE}" \
    --metadata "backup-date=${TIMESTAMP},backup-size=${BACKUP_SIZE},backup-type=database" \
    --storage-class STANDARD

echo -e "${GREEN}✅ Backup uploaded to S3: s3://${S3_BUCKET}/database-backups/${BACKUP_FILE}${NC}"

# List recent backups
echo -e "${YELLOW}📋 Recent backups in S3:${NC}"
aws s3 ls "s3://${S3_BUCKET}/database-backups/" --recursive | tail -5

# Clean up local backup
rm "${BACKUP_DIR}/${BACKUP_FILE}"
echo -e "${BLUE}🧹 Local backup file cleaned up${NC}"

# Optional: Clean up old backups (keep last 30 days)
echo -e "${YELLOW}🧹 Cleaning up old backups (older than 30 days)...${NC}"
CUTOFF_DATE=$(date -d '30 days ago' +%Y%m%d 2>/dev/null || date -v-30d +%Y%m%d 2>/dev/null || echo "20240101")

aws s3 ls "s3://${S3_BUCKET}/database-backups/" --recursive | while read -r line; do
    BACKUP_DATE=$(echo "$line" | awk '{print $1}' | tr -d '-')
    BACKUP_NAME=$(echo "$line" | awk '{print $4}')
    
    if [ "$BACKUP_DATE" -lt "$CUTOFF_DATE" ]; then
        echo -e "${BLUE}🗑️ Deleting old backup: ${BACKUP_NAME}${NC}"
        aws s3 rm "s3://${S3_BUCKET}/${BACKUP_NAME}"
    fi
done

echo -e "${GREEN}🎉 Database backup to S3 completed successfully!${NC}"

# Show cost estimation
echo -e "${BLUE}💰 Cost estimation for this backup:${NC}"
echo -e "   Storage cost: ~$0.023/GB/month"
echo -e "   Upload cost: ~$0.0004/1000 requests"
echo -e "   Total estimated cost: <$0.01"
