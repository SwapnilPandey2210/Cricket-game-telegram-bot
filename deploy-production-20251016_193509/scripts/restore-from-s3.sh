#!/bin/bash

# Database Restore Script from S3
set -e

# Configuration
S3_BUCKET=${BACKUP_S3_BUCKET:-"cricket-heritage-bot-backups"}
AWS_REGION=${AWS_REGION:-"us-east-1"}
RESTORE_DIR="/tmp/restore"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 Database Restore from S3${NC}"

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

# Create restore directory
mkdir -p "${RESTORE_DIR}"

# List available backups
echo -e "${YELLOW}📋 Available backups in S3:${NC}"
aws s3 ls "s3://${S3_BUCKET}/database-backups/" --recursive | sort -k1,2

echo ""
echo -e "${YELLOW}💡 Usage: $0 <backup-filename>${NC}"
echo -e "${YELLOW}   Example: $0 cricket_bot_backup_20241014_120000.db.gz${NC}"

if [ $# -eq 0 ]; then
    echo -e "${BLUE}📝 Please provide a backup filename to restore${NC}"
    exit 1
fi

BACKUP_FILE="$1"
S3_PATH="s3://${S3_BUCKET}/database-backups/${BACKUP_FILE}"

# Check if backup exists in S3
if ! aws s3 ls "$S3_PATH" &> /dev/null; then
    echo -e "${RED}❌ Backup file '${BACKUP_FILE}' not found in S3${NC}"
    echo -e "${YELLOW}💡 Use the list above to find available backups${NC}"
    exit 1
fi

echo -e "${YELLOW}📥 Downloading backup from S3...${NC}"
aws s3 cp "$S3_PATH" "${RESTORE_DIR}/${BACKUP_FILE}"

echo -e "${GREEN}✅ Backup downloaded: ${RESTORE_DIR}/${BACKUP_FILE}${NC}"

# Decompress if needed
if [[ "$BACKUP_FILE" == *.gz ]]; then
    echo -e "${YELLOW}📦 Decompressing backup...${NC}"
    gunzip "${RESTORE_DIR}/${BACKUP_FILE}"
    BACKUP_FILE="${BACKUP_FILE%.gz}"
fi

echo -e "${GREEN}✅ Backup decompressed: ${RESTORE_DIR}/${BACKUP_FILE}${NC}"

# Verify backup integrity
echo -e "${YELLOW}🔍 Verifying backup integrity...${NC}"
if ! sqlite3 "${RESTORE_DIR}/${BACKUP_FILE}" "PRAGMA integrity_check;" | grep -q "ok"; then
    echo -e "${RED}❌ Backup integrity check failed${NC}"
    rm -rf "${RESTORE_DIR}"
    exit 1
fi

echo -e "${GREEN}✅ Backup integrity verified${NC}"

# Create backup of current database
if [ -f "prisma/dev.db" ]; then
    echo -e "${YELLOW}💾 Creating backup of current database...${NC}"
    cp "prisma/dev.db" "prisma/dev.db.backup.$(date +%Y%m%d_%H%M%S)"
    echo -e "${GREEN}✅ Current database backed up${NC}"
fi

# Restore database
echo -e "${YELLOW}🔄 Restoring database...${NC}"
cp "${RESTORE_DIR}/${BACKUP_FILE}" "prisma/dev.db"

echo -e "${GREEN}✅ Database restored successfully!${NC}"

# Clean up
rm -rf "${RESTORE_DIR}"
echo -e "${BLUE}🧹 Temporary files cleaned up${NC}"

# Show database info
echo -e "${BLUE}📊 Database information:${NC}"
sqlite3 "prisma/dev.db" "SELECT COUNT(*) as user_count FROM User;"
sqlite3 "prisma/dev.db" "SELECT COUNT(*) as card_count FROM Card;"
sqlite3 "prisma/dev.db" "SELECT COUNT(*) as ownership_count FROM Ownership;"

echo -e "${GREEN}🎉 Database restore completed successfully!${NC}"
echo -e "${YELLOW}💡 Remember to restart your bot application${NC}"
