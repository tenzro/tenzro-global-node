// tenzro-global-node/src/config/envConfig.ts

import dotenv from 'dotenv';
import path from 'path';
import { NodeType, NodeTier } from './types';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Validate node type
function validateNodeType(type: string): NodeType {
    const validTypes: NodeType[] = ['individual', 'regional_node', 'global_node'];
    if (!validTypes.includes(type as NodeType)) {
        throw new Error(`Invalid node type: ${type}. Must be one of: ${validTypes.join(', ')}`);
    }
    return type as NodeType;
}

// Validate node tier
function validateNodeTier(tier: string): NodeTier {
    const validTiers: NodeTier[] = ['inference', 'aggregator', 'training', 'feedback'];
    if (!validTiers.includes(tier as NodeTier)) {
        throw new Error(`Invalid node tier: ${tier}. Must be one of: ${validTiers.join(', ')}`);
    }
    return tier as NodeTier;
}

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

export const envConfig = {
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
        regionalTokenRequirement: parseInt(process.env.REGIONAL_TOKEN_REQUIREMENT || '1000', 10),
        globalTokenRequirement: parseInt(process.env.GLOBAL_TOKEN_REQUIREMENT || '5000', 10),
        minRegionalValidators: parseInt(process.env.MIN_REGIONAL_VALIDATORS || '3', 10),
        minGlobalValidators: parseInt(process.env.MIN_GLOBAL_VALIDATORS || '5', 10)
    },
    tasks: {
        maxTaskDuration: parseInt(process.env.MAX_TASK_DURATION || '86400', 10),
        minTaskDuration: parseInt(process.env.MIN_TASK_DURATION || '60', 10),
        maxNodesPerTask: parseInt(process.env.MAX_NODES_PER_TASK || '100', 10),
        taskTimeout: parseInt(process.env.TASK_TIMEOUT || '3600', 10)
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
    }
};

export default envConfig;