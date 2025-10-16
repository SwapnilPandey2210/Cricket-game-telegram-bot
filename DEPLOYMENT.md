# 🚀 Cricket Heritage Bot - AWS Deployment Guide

This guide will help you deploy your Cricket Heritage Bot to AWS using ECS Fargate, ECR, and CloudFormation.

## 📋 Prerequisites

### Required Tools
- [AWS CLI](https://aws.amazon.com/cli/) (v2.0+)
- [Docker](https://www.docker.com/) (v20.0+)
- [Node.js](https://nodejs.org/) (v18+)
- [Git](https://git-scm.com/)

### AWS Account Setup
1. Create an AWS account
2. Configure AWS CLI with your credentials:
   ```bash
   aws configure
   ```
3. Ensure you have the following permissions:
   - ECS (Elastic Container Service)
   - ECR (Elastic Container Registry)
   - CloudFormation
   - IAM
   - VPC
   - CloudWatch

## 🔧 Environment Setup

### 1. Clone and Setup
```bash
git clone <your-repo-url>
cd cricket-heritage-bot
npm install
```

### 2. Environment Variables
Copy the example environment file:
```bash
cp env.example .env
```

Edit `.env` with your values:
```bash
# Required
BOT_TOKEN=your_telegram_bot_token_here
DATABASE_URL=file:./prisma/dev.db

# Optional
NODE_ENV=production
AWS_REGION=us-east-1
BACKUP_S3_BUCKET=your-backup-bucket-name
```

### 3. Database Setup
```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Seed initial data (optional)
npm run seed
```

## 🚀 Deployment Steps

### Option 1: Automated Deployment (Recommended)

1. **Set Environment Variables**
   ```bash
   export BOT_TOKEN="your_telegram_bot_token"
   export DATABASE_URL="file:./prisma/dev.db"
   ```

2. **Deploy to Production**
   ```bash
   npm run deploy production us-east-1
   ```

3. **Deploy to Staging**
   ```bash
   npm run deploy staging us-east-1
   ```

### Option 2: Manual Deployment

1. **Build and Test Locally**
   ```bash
   npm run build
   npm run docker:build
   npm run docker:run
   ```

2. **Deploy Infrastructure**
   ```bash
   aws cloudformation deploy \
     --template-file aws/cloudformation-template.yaml \
     --stack-name cricket-bot-production \
     --parameter-overrides \
       Environment=production \
       BotToken=your_bot_token \
       DatabaseUrl=file:./prisma/dev.db \
     --capabilities CAPABILITY_IAM \
     --region us-east-1
   ```

3. **Build and Push Docker Image**
   ```bash
   # Get ECR repository URI
   ECR_URI=$(aws cloudformation describe-stacks \
     --stack-name cricket-bot-production \
     --query 'Stacks[0].Outputs[?OutputKey==`ECRRepositoryURI`].OutputValue' \
     --output text)

   # Login to ECR
   aws ecr get-login-password --region us-east-1 | \
     docker login --username AWS --password-stdin $ECR_URI

   # Build and push
   docker build -t cricket-bot .
   docker tag cricket-bot:latest $ECR_URI:latest
   docker push $ECR_URI:latest
   ```

4. **Update ECS Service**
   ```bash
   aws ecs update-service \
     --cluster cricket-bot-production-cluster \
     --service cricket-bot-production-service \
     --force-new-deployment
   ```

## 📊 Monitoring and Logs

### CloudWatch Logs
View your bot logs in AWS CloudWatch:
```bash
# Get log group name
aws logs describe-log-groups \
  --log-group-name-prefix "/ecs/cricket-bot" \
  --query 'logGroups[0].logGroupName' \
  --output text
```

### Service Status
Check your service status:
```bash
aws ecs describe-services \
  --cluster cricket-bot-production-cluster \
  --services cricket-bot-production-service \
  --query 'services[0].{Status:status,RunningCount:runningCount,DesiredCount:desiredCount}'
```

## 💾 Database Backups

### Automatic Backups
The deployment includes automatic database backups to S3. Backups are created daily and stored for 30 days.

### Manual Backup
```bash
npm run backup
```

### Restore from Backup
```bash
# Download backup from S3
aws s3 cp s3://your-backup-bucket/database-backups/backup_file.db.gz ./restore.db.gz

# Decompress and restore
gunzip restore.db.gz
cp restore.db prisma/dev.db
```

## 🔄 Updates and Maintenance

### Update Bot Code
1. Make your changes
2. Test locally
3. Deploy:
   ```bash
   npm run deploy production us-east-1
   ```

### Update Dependencies
1. Update `package.json`
2. Rebuild and deploy:
   ```bash
   npm install
   npm run deploy production us-east-1
   ```

### Database Migrations
```bash
# Create migration
npx prisma migrate dev --name your_migration_name

# Deploy migration
npx prisma migrate deploy
```

## 🛠️ Troubleshooting

### Common Issues

#### 1. Deployment Fails
- Check AWS credentials: `aws sts get-caller-identity`
- Verify region: `aws configure get region`
- Check CloudFormation events in AWS Console

#### 2. Bot Not Responding
- Check ECS service status
- View CloudWatch logs
- Verify environment variables

#### 3. Database Issues
- Check database file permissions
- Verify DATABASE_URL format
- Check S3 backup bucket access

### Useful Commands

```bash
# View ECS task logs
aws logs tail /ecs/cricket-bot-production --follow

# Restart ECS service
aws ecs update-service \
  --cluster cricket-bot-production-cluster \
  --service cricket-bot-production-service \
  --force-new-deployment

# Scale service
aws ecs update-service \
  --cluster cricket-bot-production-cluster \
  --service cricket-bot-production-service \
  --desired-count 2
```

## 💰 Cost Estimation

### Monthly Costs (US East 1)
- **ECS Fargate**: ~$15-25 (256 CPU, 512 MB RAM)
- **ECR**: ~$1-2 (image storage)
- **CloudWatch Logs**: ~$1-3 (log storage)
- **S3**: ~$0.10-0.50 (backup storage)
- **Total**: ~$17-30/month

### Cost Optimization
- Use Fargate Spot for non-critical workloads
- Set up log retention policies
- Use S3 lifecycle policies for backups

## 🔒 Security Best Practices

1. **Environment Variables**: Never commit secrets to git
2. **IAM Roles**: Use least privilege principle
3. **VPC**: Deploy in private subnets for production
4. **Backups**: Encrypt database backups
5. **Monitoring**: Set up CloudWatch alarms

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review AWS CloudWatch logs
3. Check ECS service events
4. Verify environment variables

## 🎯 Next Steps

After successful deployment:
1. Set up monitoring alerts
2. Configure custom domain (if needed)
3. Set up CI/CD pipeline
4. Implement health checks
5. Set up automated scaling

---

**Happy Deploying! 🚀**
