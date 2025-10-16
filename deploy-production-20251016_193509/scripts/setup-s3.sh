#!/bin/bash

# AWS S3 Setup Script for Cricket Heritage Bot
set -e

# Configuration
BUCKET_NAME=${1:-"cricket-heritage-bot-backups-$(date +%s)"}
REGION=${2:-"us-east-1"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Setting up AWS S3 for Cricket Heritage Bot...${NC}"

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not configured. Please run 'aws configure' first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ AWS CLI is configured${NC}"

# Create S3 bucket
echo -e "${YELLOW}📦 Creating S3 bucket: ${BUCKET_NAME}${NC}"

if [ "$REGION" = "us-east-1" ]; then
    aws s3 mb "s3://${BUCKET_NAME}"
else
    aws s3 mb "s3://${BUCKET_NAME}" --region "$REGION"
fi

echo -e "${GREEN}✅ S3 bucket created: s3://${BUCKET_NAME}${NC}"

# Enable versioning
echo -e "${YELLOW}🔄 Enabling versioning...${NC}"
aws s3api put-bucket-versioning \
    --bucket "$BUCKET_NAME" \
    --versioning-configuration Status=Enabled

echo -e "${GREEN}✅ Versioning enabled${NC}"

# Set up lifecycle policy for cost optimization
echo -e "${YELLOW}💰 Setting up lifecycle policy...${NC}"

cat > /tmp/lifecycle-policy.json << EOF
{
    "Rules": [
        {
            "ID": "DeleteOldVersions",
            "Status": "Enabled",
            "Filter": {
                "Prefix": "database-backups/"
            },
            "NoncurrentVersionExpiration": {
                "NoncurrentDays": 30
            }
        },
        {
            "ID": "TransitionToIA",
            "Status": "Enabled",
            "Filter": {
                "Prefix": "database-backups/"
            },
            "Transitions": [
                {
                    "Days": 30,
                    "StorageClass": "STANDARD_IA"
                },
                {
                    "Days": 90,
                    "StorageClass": "GLACIER"
                }
            ]
        }
    ]
}
EOF

aws s3api put-bucket-lifecycle-configuration \
    --bucket "$BUCKET_NAME" \
    --lifecycle-configuration file:///tmp/lifecycle-policy.json

echo -e "${GREEN}✅ Lifecycle policy configured${NC}"

# Set up bucket policy for security
echo -e "${YELLOW}🔒 Setting up bucket policy...${NC}"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > /tmp/bucket-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowSSLRequestsOnly",
            "Effect": "Deny",
            "Principal": "*",
            "Action": "s3:*",
            "Resource": [
                "arn:aws:s3:::${BUCKET_NAME}",
                "arn:aws:s3:::${BUCKET_NAME}/*"
            ],
            "Condition": {
                "Bool": {
                    "aws:SecureTransport": "false"
                }
            }
        },
        {
            "Sid": "AllowBackupAccess",
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::${ACCOUNT_ID}:root"
            },
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::${BUCKET_NAME}",
                "arn:aws:s3:::${BUCKET_NAME}/*"
            ]
        }
    ]
}
EOF

aws s3api put-bucket-policy \
    --bucket "$BUCKET_NAME" \
    --policy file:///tmp/bucket-policy.json

echo -e "${GREEN}✅ Bucket policy configured${NC}"

# Create folder structure
echo -e "${YELLOW}📁 Creating folder structure...${NC}"
aws s3api put-object --bucket "$BUCKET_NAME" --key "database-backups/"
aws s3api put-object --bucket "$BUCKET_NAME" --key "logs/"
aws s3api put-object --bucket "$BUCKET_NAME" --key "exports/"

echo -e "${GREEN}✅ Folder structure created${NC}"

# Clean up temporary files
rm -f /tmp/lifecycle-policy.json /tmp/bucket-policy.json

echo -e "${GREEN}🎉 S3 setup completed successfully!${NC}"
echo -e "${BLUE}📋 Summary:${NC}"
echo -e "   Bucket Name: ${BUCKET_NAME}"
echo -e "   Region: ${REGION}"
echo -e "   Versioning: Enabled"
echo -e "   Lifecycle Policy: Configured"
echo -e "   Security Policy: Configured"
echo ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo -e "   1. Update your .env file with: BACKUP_S3_BUCKET=${BUCKET_NAME}"
echo -e "   2. Test backup: ./scripts/backup-db.sh"
echo -e "   3. Set up automated backups with cron"
echo ""
echo -e "${BLUE}💡 Cost estimation:${NC}"
echo -e "   - Storage: ~$0.023/GB/month"
echo -e "   - Requests: ~$0.0004/1000 requests"
echo -e "   - Expected monthly cost: $0.10-0.50"
