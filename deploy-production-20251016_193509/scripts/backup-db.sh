#!/bin/bash

# Database Backup Script for Cricket Heritage Bot
set -e

# Configuration
BACKUP_DIR="/tmp/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="cricket_bot_backup_${TIMESTAMP}.db"
S3_BUCKET=${BACKUP_S3_BUCKET:-"cricket-bot-backups"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🗄️ Starting database backup...${NC}"

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Check if database file exists
if [ ! -f "prisma/dev.db" ]; then
    echo -e "${RED}❌ Database file not found at prisma/dev.db${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Creating backup...${NC}"

# Create backup
cp "prisma/dev.db" "${BACKUP_DIR}/${BACKUP_FILE}"

# Compress backup
gzip "${BACKUP_DIR}/${BACKUP_FILE}"
BACKUP_FILE="${BACKUP_FILE}.gz"

echo -e "${GREEN}✅ Backup created: ${BACKUP_DIR}/${BACKUP_FILE}${NC}"

# Upload to S3 if AWS CLI is available and bucket is configured
if command -v aws &> /dev/null && [ ! -z "$S3_BUCKET" ]; then
    echo -e "${YELLOW}☁️ Uploading to S3...${NC}"
    
    aws s3 cp "${BACKUP_DIR}/${BACKUP_FILE}" "s3://${S3_BUCKET}/database-backups/${BACKUP_FILE}"
    
    echo -e "${GREEN}✅ Backup uploaded to S3: s3://${S3_BUCKET}/database-backups/${BACKUP_FILE}${NC}"
    
    # Clean up local backup
    rm "${BACKUP_DIR}/${BACKUP_FILE}"
    echo -e "${BLUE}🧹 Local backup file cleaned up${NC}"
else
    echo -e "${YELLOW}⚠️ S3 upload skipped (AWS CLI not available or bucket not configured)${NC}"
    echo -e "${BLUE}📁 Backup saved locally: ${BACKUP_DIR}/${BACKUP_FILE}${NC}"
fi

# Get backup size
BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" 2>/dev/null | cut -f1 || echo "Unknown")
echo -e "${BLUE}📊 Backup size: ${BACKUP_SIZE}${NC}"

echo -e "${GREEN}🎉 Database backup completed successfully!${NC}"
