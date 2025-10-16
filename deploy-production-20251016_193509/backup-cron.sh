#!/bin/bash
# Daily backup script
cd "$(dirname "$0")"
export BACKUP_S3_BUCKET="cricket-heritage-bot-backups-1760623180"
./scripts/backup-to-s3.sh
