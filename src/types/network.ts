// tenzro-global-node/src/types/network.ts

import { RegionalCapacity } from "./task";

export type NodeType = 'individual' | 'regional_node' | 'global_node';
export type NodeTier = 'inference' | 'aggregator' | 'training' | 'feedback';
export type TaskStatus = 'pending' | 'assigned' | 'processing' | 'completed' | 'failed';

export interface PeerInfo {
    peerId: string;
    nodeType: NodeType;
    nodeTier: NodeTier;
    region: string;
    tokenBalance: number;
    connected: boolean;
    lastSeen: string;
}

export interface RegionInfo {
    id: string;
    name: string;
    validators: Set<string>;
    peers: Set<string>;
    lastUpdate: Date;
    status: 'active' | 'degraded' | 'offline';
    metrics: {
        totalTasks: number;
        completedTasks: number;
        activeNodes: number;
        totalRewards: number;
        averageCompletionTime: number;
        successRate: number;
    };
}

export interface Task {
    taskId: string;
    type: 'compute' | 'storage' | 'inference';
    requirements: {
        minTier: NodeTier;
        minStorage?: number;    // in GB
        minMemory?: number;     // in GB
        gpuRequired?: boolean;
        priority: 'low' | 'medium' | 'high';
        estimatedDuration: number; // in seconds
        maxNodes: number;
    };
    data: any;
    status: TaskStatus;
    timestamp: string;
    expiry: string;
    submitter: string;
}

export interface TaskDistribution {
    taskId: string;
    distribution: Map<string, number>; // region -> node count
    timestamp: string;
}

export interface NodeInfo {
    peerId: string;
    nodeType: NodeType;
    resources: {
        cpu: number;
        memory: number;
        storage: number;
        bandwidth: number;
    };
    status: 'online' | 'offline';
    tasks: string[];
    lastUpdate: string;
}

export interface TaskInfo {
    taskId: string;
    status: TaskStatus;
    distribution: TaskDistribution;
    progress: number;
    startTime: string;
    lastUpdate: string;
}

export interface NetworkMessage {
    type: 'task_distribution' | 'state_update' | 'node_status';
    sender: string;
    data: any;
    timestamp: string;
}

export interface NetworkState {
    regions: Map<string, RegionalCapacity>;
    globalMetrics: {
        totalNodes: number;
        activeNodes: number;
        taskSuccess: number;
        avgResponseTime: number;
    };
    timestamp: string;
}

export interface RegionalResponse {
    regionId: string;
    validatorId: string;
    capacity: {
        availableNodes: number;
        nodeTier: NodeTier;
        estimatedTime: number;
    };
    acceptance: boolean;
    priority: number;
}