// tenzro-global-node/src/types/crossRegion.ts

export type TaskStatus = 'pending' | 'assigned' | 'processing' | 'completed' | 'failed';
export type NodeTier = 'inference' | 'aggregator' | 'training' | 'feedback';
export type TaskType = 
    | 'compute' 
    | 'storage' 
    | 'model_training' 
    | 'inference' 
    | 'data_processing';

export interface NetworkState {
    regions: Map<string, RegionCapacity>;
    globalMetrics: {
        totalNodes: number;
        activeNodes: number;
        taskSuccess: number;
        avgResponseTime: number;
        currentLoad: number;
    };
    timestamp: string;
}

export interface RegionCapacity {
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
        throughput: number;
    };
    taskCount: {
        active: number;
        completed: number;
        failed: number;
        queued: number;
    };
    resources: {
        totalCPU: number;
        totalMemory: number;
        totalStorage: number;
        availableCPU: number;
        availableMemory: number;
        availableStorage: number;
    };
}

export interface CrossRegionTaskStatus {
    state: TaskStatus;
    regionalProgress: Map<string, number>;
    consolidationRequired: boolean;
    consolidationStatus?: 'pending' | 'in_progress' | 'completed' | 'failed';
    regionsCompleted?: Set<string>;
    timestamp: string;
    errors?: TaskError[];
}

export interface TaskError {
    regionId: string;
    error: string;
    timestamp: string;
}

export interface RegionTaskMetrics {
    completionRate: number;
    averageLatency: number;
    resourceUtilization: number;
    failureRate: number;
    performance: {
        successRate: number;
        avgResponseTime: number;
        reliability: number;
    };
    timestamp: string;
}

export interface TaskDistribution {
    distribution: Map<string, number>;
    totalNodes: number;
    timestamp: string;
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
        minReliability?: number;
        resourceConstraints?: ResourceConstraints;
    };
    duration: {
        expected: number;
        maximum: number;
    };
}

export interface ResourceConstraints {
    minCPU?: number;
    minMemory?: number;
    minStorage?: number;
    minBandwidth?: number;
    gpuRequired?: boolean;
    specialHardware?: string[];
}

export interface CrossRegionTask {
    taskId: string;
    type: TaskType;
    requirements: TaskRequirements;
    regionDistribution?: TaskDistribution;
    coordinatorId?: string;
    status: CrossRegionTaskStatus;
    timestamp: string;
    source: {
        nodeId: string;
        region: string;
    };
}

export interface ConsolidatedResult {
    type: 'ensemble' | 'aggregated_data' | 'computed_result';
    data: any;
    timestamp: string;
    metadata?: {
        regions: string[];
        metrics: {
            totalTime: number;
            nodesUsed: number;
        };
    };
}

export interface TaskMetrics {
    duration: number;
    totalNodes: number;
    resourceUsage: {
        cpu: {
            average: number;
            peak: number;
        };
        memory: {
            average: number;
            peak: number;
        };
        storage: {
            used: number;
            peak: number;
        };
        network: {
            ingress: number;
            egress: number;
        };
    };
    performance: {
        latency: {
            average: number;
            p95: number;
            p99: number;
        };
        throughput: number;
        successRate: number;
        errorRate: number;
    };
    cost: {
        total: number;
        breakdown: {
            compute: number;
            storage: number;
            network: number;
        };
        perRegion: Map<string, number>;
    };
}

export interface Task {
    taskId: string;
    type: TaskType;
    requirements: TaskRequirements;
    budget: TaskBudget;
    source: {
        nodeId: string;
        region: string;
    };
    expiry: string;
}

// Now properly define TaskBroadcast
export interface TaskBroadcast extends Task {
    timestamp: string;
    status: TaskStatus;
    priority: 'low' | 'medium' | 'high'; 
}

// Update CrossRegionTask to properly extend Task
export interface CrossRegionTask extends Task {
    crossRegion: boolean;
    regionDistribution?: TaskDistribution;
    coordinatorId?: string;
    status: CrossRegionTaskStatus;
    timestamp: string;
}

// Add TaskBudget interface if not already present
export interface TaskBudget {
    maxAmount: number;
    tokenType: string;
    paymentMethod: 'prepaid' | 'postpaid';
    penalties?: {
        latePenalty: number;
        failurePenalty: number;
        slaBreachPenalty?: number;
    };
}