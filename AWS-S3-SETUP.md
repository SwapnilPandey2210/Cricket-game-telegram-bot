# 🚀 AWS S3 Setup Guide for Cricket Heritage Bot

This guide will help you set up AWS S3 for database backups and deploy your Cricket Heritage Bot to AWS.

## 📋 Prerequisites

### Required Tools
- [AWS CLI](https://aws.amazon.com/cli/) (v2.0+)
- [Docker](https://www.docker.com/) (v20.0+)
- [Node.js](https://nodejs.org/) (v18+)
- [Git](https://git-scm.com/)

### AWS Account Setup
1. Create an AWS account at [aws.amazon.com](https://aws.amazon.com)
2. Create an IAM user with S3 permissions
3. Download access keys (Access Key ID and Secret Access Key)

## 🔧 Quick Setup

### 1. Configure AWS CLI
```bash
aws configure
```
Enter your:
- AWS Access Key ID
- AWS Secret Access Key
- Default region (e.g., `us-east-1`)
- Default output format (`json`)

### 2. Set Environment Variables
```bash
export BOT_TOKEN="your_telegram_bot_token"
export BACKUP_S3_BUCKET="your-unique-bucket-name"
export AWS_REGION="us-east-1"
```

### 3. Setup S3 Bucket
```bash
npm run setup:s3
```

### 4. Test Backup
```bash
npm run backup:s3
```

### 5. Deploy to AWS
```bash
npm run deploy:aws production us-east-1
```

## 📦 Manual Setup Steps

### Step 1: Create S3 Bucket
```bash
# Create bucket
aws s3 mb s3://cricket-heritage-bot-backups-$(date +%s)

# Enable versioning
aws s3api put-bucket-versioning \
    --bucket your-bucket-name \
    --versioning-configuration Status=Enabled
```

### Step 2: Configure Bucket Policy
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowSSLRequestsOnly",
            "Effect": "Deny",
            "Principal": "*",
            "Action": "s3:*",
            "Resource": [
                "arn:aws:s3:::your-bucket-name",
                "arn:aws:s3:::your-bucket-name/*"
            ],
            "Condition": {
                "Bool": {
                    "aws:SecureTransport": "false"
                }
            }
        }
    ]
}
```

### Step 3: Set Up Lifecycle Policy
```json
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
```

## 🗄️ Database Backup & Restore

### Backup to S3
```bash
# Manual backup
npm run backup:s3

# Or use the script directly
./scripts/backup-to-s3.sh
```

### Restore from S3
```bash
# List available backups
aws s3 ls s3://your-bucket-name/database-backups/

# Restore specific backup
npm run restore:s3 cricket_bot_backup_20241014_120000.db.gz
```

### Automated Backups
Add to crontab for daily backups:
```bash
# Edit crontab
crontab -e

# Add this line for daily backup at 2 AM
0 2 * * * cd /path/to/your/bot && ./scripts/backup-to-s3.sh
```

## 🚀 Deployment Options

### Option 1: Simple EC2 Deployment
1. Launch EC2 instance (t2.micro for testing)
2. Install Node.js, Docker, and AWS CLI
3. Upload your deployment package
4. Run the startup script

### Option 2: Docker Deployment
```bash
# Build Docker image
docker build -t cricket-heritage-bot .

# Run with environment variables
docker run -d \
  --name cricket-bot \
  --env-file .env.production \
  --restart unless-stopped \
  cricket-heritage-bot
```

### Option 3: ECS Fargate (Recommended for Production)
Use the CloudFormation template in the `aws/` directory for a complete ECS setup.

## 📊 Monitoring & Maintenance

### Health Checks
```bash
# Check if bot is running
ps aux | grep "node.*dist/index.js"

# Check database integrity
sqlite3 prisma/dev.db "PRAGMA integrity_check;"

# Check S3 backups
aws s3 ls s3://your-bucket-name/database-backups/ --recursive
```

### Log Monitoring
```bash
# View application logs
tail -f /var/log/cricket-bot.log

# View backup logs
grep "backup" /var/log/syslog
```

## 💰 Cost Optimization

### S3 Storage Classes
- **STANDARD**: Immediate access, $0.023/GB/month
- **STANDARD_IA**: Infrequent access, $0.0125/GB/month
- **GLACIER**: Archive, $0.004/GB/month

### Lifecycle Policies
- Move to IA after 30 days
- Move to Glacier after 90 days
- Delete old versions after 1 year

### Estimated Monthly Costs
| Users | Daily Cards | Monthly Storage | S3 Cost |
|-------|-------------|-----------------|---------|
| 50    | 100         | ~150MB          | $0.01   |
| 200   | 200         | ~1.5GB          | $0.10   |
| 500   | 500         | ~7.5GB          | $0.50   |
| 1000  | 1000        | ~30GB           | $2.00   |

## 🔒 Security Best Practices

### 1. IAM Permissions
Create a dedicated IAM user with minimal permissions:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::your-bucket-name",
                "arn:aws:s3:::your-bucket-name/*"
            ]
        }
    ]
}
```

### 2. Encryption
Enable server-side encryption for your S3 bucket:
```bash
aws s3api put-bucket-encryption \
    --bucket your-bucket-name \
    --server-side-encryption-configuration '{
        "Rules": [
            {
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "AES256"
                }
            }
        ]
    }'
```

### 3. Access Logging
Enable access logging to monitor bucket usage:
```bash
aws s3api put-bucket-logging \
    --bucket your-bucket-name \
    --bucket-logging-status '{
        "LoggingEnabled": {
            "TargetBucket": "your-logging-bucket",
            "TargetPrefix": "access-logs/"
        }
    }'
```

## 🛠️ Troubleshooting

### Common Issues

#### 1. AWS Credentials Not Found
```bash
# Check credentials
aws sts get-caller-identity

# Reconfigure if needed
aws configure
```

#### 2. S3 Bucket Access Denied
- Check IAM permissions
- Verify bucket policy
- Ensure SSL/TLS is used

#### 3. Backup Fails
```bash
# Check database file
ls -la prisma/dev.db

# Test database integrity
sqlite3 prisma/dev.db "PRAGMA integrity_check;"

# Check AWS CLI
aws s3 ls s3://your-bucket-name/
```

#### 4. Restore Fails
```bash
# List available backups
aws s3 ls s3://your-bucket-name/database-backups/

# Check backup file integrity
aws s3 cp s3://your-bucket-name/database-backups/backup.db.gz - | gunzip | sqlite3 - "PRAGMA integrity_check;"
```

### Useful Commands

```bash
# Check S3 bucket size
aws s3 ls s3://your-bucket-name --recursive --summarize

# Download latest backup
aws s3 cp s3://your-bucket-name/database-backups/$(aws s3 ls s3://your-bucket-name/database-backups/ | sort | tail -1 | awk '{print $4}') ./latest-backup.db.gz

# Monitor backup costs
aws ce get-cost-and-usage \
    --time-period Start=2024-01-01,End=2024-02-01 \
    --granularity MONTHLY \
    --metrics BlendedCost \
    --group-by Type=DIMENSION,Key=SERVICE
```

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review AWS CloudWatch logs
3. Verify S3 bucket permissions
4. Check database integrity

## 🎯 Next Steps

After successful S3 setup:
1. Set up automated backups
2. Configure monitoring alerts
3. Implement disaster recovery procedures
4. Set up cost monitoring
5. Create backup retention policies

---

**Happy Deploying! 🚀**

## 📚 Additional Resources

- [AWS S3 Documentation](https://docs.aws.amazon.com/s3/)
- [AWS CLI Reference](https://docs.aws.amazon.com/cli/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [Docker Documentation](https://docs.docker.com/)
