// tenzro-global-node/src/types/task.ts

import { NodeTier, TaskStatus, TaskType } from "../types";

export interface TaskBroadcast {
    taskId: string;
    type: TaskType;
    requirements: TaskRequirements;
    budget: TaskBudget;
    source: {
        nodeId: string;
        region: string;
    };
    timestamp: string;
    expiry: string;
    status: TaskStatus;
}

export interface TaskRequirements {
    nodeTier: NodeTier;
    minNodes: number;
    maxNodes: number;
    priority: 'low' | 'medium' | 'high';
    constraints?: {
        region?: string[];
        maxLatency?: number;
        redundancy?: number;
    };
    duration: {
        expected: number;  // in seconds
        maximum: number;   // in seconds
    };
}

export interface TaskBudget {
    maxAmount: number;
    tokenType: string;
    paymentMethod: 'prepaid' | 'postpaid';
    penalties?: {
        latePenalty: number;
        failurePenalty: number;
    };
}

export interface RegionalCapacity {
    region: string;
    nodeCount: {
        total: number;
        byTier: Record<NodeTier, number>;
        available: number;
    };
    performance: {
        successRate: number;
        avgResponseTime: number;
        reliability: number;
    };
    taskCount: {
        active: number;
        completed: number;
        failed: number;
    };
}

export interface TaskDistribution {
    taskId: string;
    regions: Map<string, {
        nodeCount: number;
        priorityScore: number;
    }>;
    timestamp: string;
}