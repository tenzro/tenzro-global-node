// tenzro-global-node/src/config/index.ts

import dotenv from 'dotenv';
import path from 'path';
import { Config, NodeType, NodeTier } from '../types/index';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Helper to get required env variable
function getRequiredEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

// Parse bootstrap nodes
function parseBootstrapNodes(nodes: string): string[] {
    return nodes.split(',').map(node => node.trim());
}

const config: Config = {
    node: {
        nodeId: process.env.NODE_ID || `node_${Math.random().toString(36).substr(2, 9)}`,
        type: (process.env.NODE_TYPE || 'global_node') as NodeType,
        tier: (process.env.NODE_TIER || 'training') as NodeTier,
        tokenBalance: parseInt(process.env.TOKEN_BALANCE || '10000', 10),
        region: process.env.REGION || 'default',
        port: parseInt(process.env.PORT || '8080', 10)
    },
    network: {
        bootstrapNodes: parseBootstrapNodes(process.env.BOOTSTRAP_NODES || ''),
        dht: {
            refreshInterval: parseInt(process.env.DHT_REFRESH_INTERVAL || '60000', 10),
            replicationFactor: parseInt(process.env.DHT_REPLICATION_FACTOR || '3', 10),
            timeout: parseInt(process.env.DHT_TIMEOUT || '10000', 10)
        },
        healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000', 10),
        cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL || '300000', 10),
        peerTimeout: parseInt(process.env.PEER_TIMEOUT || '600000', 10)
    },
    validator: {
        regionalTokenRequirement: parseInt(process.env.REGIONAL_TOKEN_REQUIREMENT || '5000', 10),
        globalTokenRequirement: parseInt(process.env.GLOBAL_TOKEN_REQUIREMENT || '10000', 10),
        minRegionalValidators: parseInt(process.env.MIN_REGIONAL_VALIDATORS || '3', 10),
        minGlobalValidators: parseInt(process.env.MIN_GLOBAL_VALIDATORS || '5', 10)
    },
    tasks: {
        maxTaskDuration: parseInt(process.env.MAX_TASK_DURATION || '86400', 10),
        minTaskDuration: parseInt(process.env.MIN_TASK_DURATION || '60', 10),
        maxNodesPerTask: parseInt(process.env.MAX_NODES_PER_TASK || '100', 10),
        taskTimeout: parseInt(process.env.TASK_TIMEOUT || '3600', 10),
        minNodesPerTask: parseInt(process.env.MIN_NODES_PER_TASK || '2', 10)
    },
    metrics: {
        updateInterval: parseInt(process.env.METRICS_UPDATE_INTERVAL || '15000', 10),
        retentionPeriod: parseInt(process.env.METRICS_RETENTION_PERIOD || '86400000', 10),
        healthThresholds: {
            minActivePeers: parseFloat(process.env.MIN_ACTIVE_PEERS_RATIO || '0.7'),
            minValidators: parseInt(process.env.MIN_VALIDATORS || '3', 10)
        }
    },
    parameters: {
        updateInterval: parseInt(process.env.PARAMETER_UPDATE_INTERVAL || '3600000', 10),
        parametersEndpoint: process.env.PARAMETER_ENDPOINT || 'https://api.tenzro.com/network/parameters',
        retryAttempts: parseInt(process.env.PARAMETER_RETRY_ATTEMPTS || '3', 10),
        retryDelay: parseInt(process.env.PARAMETER_RETRY_DELAY || '60000', 10),
        refreshInterval: parseInt(process.env.PARAMETER_REFRESH_INTERVAL || '3600000', 10)
    },
    crossRegion: {
        capacityUpdateInterval: parseInt(process.env.CAPACITY_UPDATE_INTERVAL || '30000', 10),
        taskCleanupInterval: parseInt(process.env.TASK_CLEANUP_INTERVAL || '300000', 10),
        singleRegionNodeLimit: parseInt(process.env.SINGLE_REGION_NODE_LIMIT || '50', 10),
        minNodesPerRegion: parseInt(process.env.MIN_NODES_PER_REGION || '2', 10),
        resourceWeights: {
            cpu: parseFloat(process.env.RESOURCE_WEIGHT_CPU || '0.4'),
            memory: parseFloat(process.env.RESOURCE_WEIGHT_MEMORY || '0.3'),
            storage: parseFloat(process.env.RESOURCE_WEIGHT_STORAGE || '0.3')
        },
        resources: {
            maxMemory: parseInt(process.env.MAX_MEMORY || '32768', 10),
            maxStorage: parseInt(process.env.MAX_STORAGE || '1024', 10)
        },
        retentionPeriod: parseInt(process.env.CROSS_REGION_RETENTION_PERIOD || '604800000', 10),
        updateInterval: parseInt(process.env.CROSS_REGION_UPDATE_INTERVAL || '60000', 10),
        heartbeatTimeout: parseInt(process.env.CROSS_REGION_HEARTBEAT_TIMEOUT || '180000', 10),
        maxRetries: parseInt(process.env.CROSS_REGION_MAX_RETRIES || '3', 10)
    },
    security: {
        minEncryptionKeyLength: parseInt(process.env.MIN_ENCRYPTION_KEY_LENGTH || '2048', 10),
        messageTimeout: parseInt(process.env.MESSAGE_TIMEOUT || '30000', 10),
        maxMessageSize: parseInt(process.env.MAX_MESSAGE_SIZE || '5242880', 10),
        maxConcurrentConnections: parseInt(process.env.MAX_CONCURRENT_CONNECTIONS || '1000', 10),
        rateLimit: {
            windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
            maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)
        }
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'json',
        filepath: process.env.LOG_FILE_PATH || './logs/global-node.log',
        maxSize: parseInt(process.env.LOG_MAX_SIZE || '10485760', 10),
        maxFiles: parseInt(process.env.LOG_MAX_FILES || '5', 10),
        compress: process.env.LOG_COMPRESS === 'true'
    }
};

if (config.node.type === 'global_node' && config.node.tokenBalance < config.validator.globalTokenRequirement) {
    throw new Error(`Insufficient tokens for global node. Required: ${config.validator.globalTokenRequirement}, Have: ${config.node.tokenBalance}`);
}

if (!config.network.bootstrapNodes.length) {
    throw new Error('At least one bootstrap node must be configured');
}

if (config.node.port < 1024 || config.node.port > 65535) {
    throw new Error('Port must be between 1024 and 65535');
}

// Validate resource weights sum to 1
const resourceWeightSum = Object.values(config.crossRegion.resourceWeights).reduce((sum, weight) => sum + weight, 0);
if (Math.abs(resourceWeightSum - 1) > 0.001) { // Allow for small floating point differences
    throw new Error('Resource weights must sum to 1');
}

// Validate timing configurations
if (config.parameters.retryDelay >= config.parameters.updateInterval) {
    throw new Error('Parameter retry delay must be less than update interval');
}

if (config.crossRegion.heartbeatTimeout >= config.crossRegion.updateInterval) {
    throw new Error('Heartbeat timeout must be less than update interval');
}

// Validate logging configuration
if (config.logging.maxFiles < 1) {
    throw new Error('Maximum number of log files must be at least 1');
}

if (config.logging.maxSize < 1048576) { // 1MB minimum
    throw new Error('Maximum log file size must be at least 1MB');
}

// Export validated configuration
export default config as Readonly<Config>;

// Export specific configuration getters for convenience
export function getNodeConfig() {
    return config.node;
}

export function getNetworkConfig() {
    return config.network;
}

export function getValidatorConfig() {
    return config.validator;
}

export function getTaskConfig() {
    return config.tasks;
}

export function getMetricsConfig() {
    return config.metrics;
}

export function getParametersConfig() {
    return config.parameters;
}

export function getCrossRegionConfig() {
    return config.crossRegion;
}

export function getSecurityConfig() {
    return config.security;
}

export function getLoggingConfig() {
    return config.logging;
}

// Helper function to update configuration at runtime (if needed)
export function updateConfig(updates: Partial<Config>): void {
    Object.assign(config, updates);
}