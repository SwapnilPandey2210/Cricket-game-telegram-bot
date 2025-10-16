#!/bin/bash
set -e

echo "🚀 Starting Cricket Heritage Bot..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

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
