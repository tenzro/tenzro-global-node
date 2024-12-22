# deploy-global.sh
#!/bin/bash
# Script to deploy global nodes

set -e

# Path to config file
CONFIG_FILE=".env"

# Load environment variables if config exists
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
fi

# Set defaults if not provided in config
REGION=${REGION:-"us"}
BOOTSTRAP_NODES=${BOOTSTRAP_NODES:-""}

# Deploy the application
heroku create "tenzro-global-node-${REGION}" --region $REGION

# Configure the application
heroku config:set \
    NODE_ENV=production \
    NODE_TYPE=global_node \
    NODE_TIER=training \
    REGION=$REGION \
    TOKEN_BALANCE=10000 \
    DHT_ENABLED=true \
    DHT_REFRESH_INTERVAL=60000 \
    DHT_REPLICATION_FACTOR=3 \
    METRICS_UPDATE_INTERVAL=15000 \
    HEALTH_CHECK_INTERVAL=30000 \
    -a "tenzro-global-node-${REGION}"

if [ ! -z "$BOOTSTRAP_NODES" ]; then
    heroku config:set BOOTSTRAP_NODES=$BOOTSTRAP_NODES -a "tenzro-global-node-${REGION}"
fi

# Set up build packs
heroku buildpacks:clear -a "tenzro-global-node-${REGION}"
heroku buildpacks:add heroku/nodejs -a "tenzro-global-node-${REGION}"

# Scale the dyno
heroku ps:scale web=1:standard-2x -a "tenzro-global-node-${REGION}"

# Deploy the code
git push heroku main