// tenzro-global-node/src/types/index.ts

import { WebSocket } from 'ws';

// Extended WebSocket interface with isAlive property
export interface ExtendedWebSocket extends WebSocket {
    isAlive: boolean;
}

// Core type definitions
export type NodeType = 'individual' | 'regional_node' | 'global_node';
export type NodeTier = 'inference' | 'aggregator' | 'training' | 'feedback';
export type TaskType = 'compute' | 'storage' | 'model_training' | 'inference' | 'data_processing';
export type TaskStatus = 'pending' | 'assigned' | 'processing' | 'completed' | 'failed';
export type RegionStatus = 'active' | 'degraded' | 'offline';
export type TaskProcessingState = 'queued' | 'running' | 'consolidating' | 'finalizing';
export type ConsolidationStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type TaskDistributionStrategy = 'balanced' | 'performance' | 'cost-optimized' | 'round_robin' | 'random' | 'default';

export type MessageType = 
    | 'join' 
    | 'leave'
    | 'peer_joined'
    | 'peer_left'
    | 'node_status'
    | 'network_state'
    | 'error'
    | 'task_broadcast'
    | 'task_assignment'
    | 'task_accepted'
    | 'task_rejected'
    | 'task_completed'
    | 'task_failed'
    | 'task_progress'
    | 'reward_distribution'
    | 'validator_message'
    | 'heartbeat'
    | 'heartbeat_response'
    | 'state_update'
    | 'peer_update'
    | 'regional_response'
    | 'task_consolidation'
    | 'task_redistribution'
    | 'task_verification';

// Task Core Interfaces
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
    distributionStrategy?: TaskDistributionStrategy;
    priority: 'low' | 'medium' | 'high';
    retryPolicy?: TaskRetryPolicy;
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

export interface TaskBudget {
    maxAmount: number;
    tokenType: string;
    paymentMethod: 'prepaid' | 'postpaid';
    penalties?: {
        latePenalty: number;
        failurePenalty: number;
        slaBreachPenalty?: number;
    };
    rewards?: {
        earlyCompletion?: number;
        highPerformance?: number;
    };
}

export interface TaskRetryPolicy {
    maxAttempts: number;
    backoffMultiplier: number;
    maxBackoffDelay: number;
    retryableErrors: string[];
}

// Cross-Region Task Interfaces
export interface CrossRegionTask extends TaskBroadcast {
    crossRegion: boolean;
    regionDistribution?: TaskDistribution;
    coordinatorId?: string;
    status: TaskStatus;
    crossRegionStatus: CrossRegionTaskStatus;
    consolidationRules?: ConsolidationRules;
}

export interface CrossRegionTaskStatus {
    state: TaskStatus;
    processingState: TaskProcessingState;
    regionalProgress: Map<string, RegionalProgress>;
    consolidationRequired: boolean;
    consolidationStatus?: ConsolidationStatus;
    regionsCompleted?: Set<string>;
    lastUpdated: string;
    timestamp: string;
    errors?: TaskError[];
    metrics: TaskMetrics;
}

export interface RegionalProgress {
    progress: number;
    state: TaskProcessingState;
    nodesAssigned: number;
    startTime: string;
    lastUpdate: string;
    performance: {
        cpu: number;
        memory: number;
        latency: number;
    };
}

export interface ConsolidationRules {
    strategy: 'average' | 'weighted' | 'ensemble' | 'custom';
    weights?: Map<string, number>;
    customHandler?: string;
    validationRules?: ValidationRule[];
}

export interface ValidationRule {
    type: 'threshold' | 'consensus' | 'custom';
    parameter: string;
    threshold?: number;
    consensusPercentage?: number;
    customValidation?: string;
}

export interface TaskError {
    code: string;
    message: string;
    severity: 'warning' | 'error' | 'fatal';
    region?: string;
    timestamp: string;
    context?: any;
}

// Task Distribution and Results
export interface TaskDistribution {
    taskId: string;
    distribution: [string, RegionAllocation][]; // [regionId, allocation]
    regions: Map<string, { nodeCount: number; priorityScore: number }>;
    timestamp: string;
    totalNodes: number;
    strategy: TaskDistributionStrategy;
    version: number;
}

export interface RegionAllocation {
    nodeCount: number;
    tier: NodeTier;
    priority: number;
    constraints: ResourceConstraints;
}

export interface TaskResult {
    taskId: string;
    type: TaskType;
    status: TaskStatus;
    results: Map<string, RegionResult>;
    consolidatedResult?: any;
    metrics: TaskMetrics;
    timestamp: string;
}

export interface RegionResult {
    regionId: string;
    data: any;
    metrics: RegionTaskMetrics;
    validation: ResultValidation;
}

export interface ResultValidation {
    isValid: boolean;
    score: number;
    checks: ValidationCheck[];
}

export interface ValidationCheck {
    name: string;
    passed: boolean;
    value: any;
    threshold: any;
}

// Metrics Interfaces
export interface TaskMetrics {
    duration: number;
    totalNodes: number;
    resourceUsage: ResourceUsage;
    performance: PerformanceMetrics;
    cost: CostMetrics;
    timestamp: string;
}

export interface ResourceUsage {
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
}

export interface PerformanceMetrics {
    latency: {
        average: number;
        p95: number;
        p99: number;
    };
    throughput: number;
    successRate: number;
    errorRate: number;
}

export interface CostMetrics {
    totalCost: number;
    breakdown: {
        compute: number;
        storage: number;
        network: number;
    };
    perRegion: Map<string, number>;
}

export interface RegionTaskMetrics {
    completionRate: number;
    averageLatency: number;
    resourceUtilization: number;
    failureRate: number;
    performance: PerformanceMetrics;
    timestamp: string;
}

// Network State and Configuration
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

// Network Parameters
export interface NetworkParameters {
    validatorRequirements: {
        globalNodeStake: number;
        regionalNodeStake: number;
        minUptime: number;
        minReliability: number;
    };
    networkEconomics: {
        taskFeePercentage: number;
        validatorRewardShare: number;
        minimumTaskValue: number;
        penaltyRates: {
            slaBreachPenalty: number;
            taskFailurePenalty: number;
        };
    };
    operationalLimits: {
        maxTaskDuration: number;
        minTaskDuration: number;
        maxNodesPerTask: number;
        minNodesPerTask: number;
        maxConcurrentTasks: number;
        maxRetries: number;
    };
    crossRegionLimits: {
        minRegionsPerTask: number;
        maxRegionsPerTask: number;
        minNodesPerRegion: number;
        maxNodesPerRegion: number;
        maxCrossRegionLatency: number;
        minRegionReliability: number;
    };
}

// Configuration Interfaces
export interface Config {
    node: NodeConfig;
    network: NetworkConfig;
    validator: ValidatorConfig;
    tasks: TasksConfig;
    metrics: MetricsConfig;
    crossRegion: CrossRegionConfig;
    parameters: ParameterConfig;
    security: SecurityConfig;
    logging: LoggingConfig;
}

export interface NodeConfig {
    type: NodeType;
    nodeId: string;
    tier: NodeTier;
    tokenBalance: number;
    region: string;
    port: number;
}

export interface NetworkConfig {
    bootstrapNodes: string[];
    dht: {
        refreshInterval: number;
        replicationFactor: number;
        timeout: number;
    };
    healthCheckInterval: number;
    cleanupInterval: number;
    peerTimeout: number;
}

export interface ValidatorConfig {
    regionalTokenRequirement: number;
    globalTokenRequirement: number;
    minRegionalValidators: number;
    minGlobalValidators: number;
}

export interface TasksConfig {
    maxTaskDuration: number;
    minTaskDuration: number;
    maxNodesPerTask: number;
    taskTimeout: number;
    minNodesPerTask: number;
}

export interface MetricsConfig {
    updateInterval: number;
    retentionPeriod: number;
    healthThresholds: {
        minActivePeers: number;
        minValidators: number;
    };
}

export interface CrossRegionConfig {
    capacityUpdateInterval: number;
    taskCleanupInterval: number;
    singleRegionNodeLimit: number;
    minNodesPerRegion: number;
    resourceWeights: {
        cpu: number;
        memory: number;
        storage: number;
    };
    resources: {
        maxMemory: number;
        maxStorage: number;
    };
    retentionPeriod: number;
    updateInterval: number;
    heartbeatTimeout: number;
    maxRetries: number;
}

export interface ParameterConfig {
    updateInterval: number;
    parametersEndpoint: string;
    retryAttempts: number;
    retryDelay: number;
    refreshInterval: number;
}

export interface SecurityConfig {
    minEncryptionKeyLength: number;
    messageTimeout: number;
    maxMessageSize: number;
    maxConcurrentConnections: number;
    rateLimit: {
        windowMs: number;
        maxRequests: number;
    };
}

export interface LoggingConfig {
    level: string;
    format: string;
    filepath: string;
    maxSize: number;
    maxFiles: number;
    compress: boolean;
}

// Task-related interfaces
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

export interface TaskData {
    input: any;
    config: any;
    resultEndpoint?: string;
}

export interface TaskReward {
    total: number;
    perNode: number;
    validatorShare: number;
    deadline: string;
    penaltyRate: number;
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
    status: TaskStatus;
    timestamp: string;
    expiry: string;
}

export interface CrossRegionTask extends Task {
    crossRegion: boolean;
    regionDistribution?: TaskDistribution;
    coordinatorId?: string;
    crossRegionStatus: CrossRegionTaskStatus;
}

export interface CrossRegionTaskStatus {
    state: TaskStatus;
    regionalProgress: Map<string, RegionalProgress>;
    consolidationRequired: boolean;
    consolidationStatus?: 'pending' | 'in_progress' | 'completed' | 'failed';
    regionsCompleted?: Set<string>;
    timestamp: string;
}

export interface TaskDistribution {
    distribution: [string, RegionAllocation][];
    timestamp: string;
    totalNodes: number;
}

// Node and Peer Interfaces
export interface PeerInfo {
    peerId: string;
    nodeType: NodeType;
    nodeTier: NodeTier;
    region: string;
    tokenBalance: number;
    connected: boolean;
    lastSeen: string;
}

export interface ConnectedPeer {
    ws: ExtendedWebSocket;
    info: PeerInfo;
    joinTime: Date;
    lastActivity: Date;
    status: NodeStatus;
}

export interface NodeStatus {
    peerId: string;
    online: boolean;
    nodeType: NodeType;
    nodeTier: NodeTier;
    region: string;
    connections: number;
    resources: ResourceStats;
    earnings: number;
    activeTasks: number;
    completedTasks: number;
    lastUpdate: string;
}

export interface ResourceStats {
    cpu: number;
    memory: number;
    storage: number;
    bandwidth: number;
    timestamp: string;
}

// Network and Region Interfaces
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

export interface RegionInfo {
    id: string;
    name: string;
    validators: Set<string>;
    peers: Set<string>;
    lastUpdate: Date;
    status: RegionStatus;
    metrics: RegionMetrics;
}

export interface RegionMetrics {
    totalTasks: number;
    completedTasks: number;
    activeNodes: number;
    totalRewards: number;
    averageCompletionTime: number;
    successRate: number;
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
}

export interface RegionTaskMetrics {
    completionRate: number;
    averageLatency: number;
    resourceUtilization: number;
    failureRate: number;
    timestamp: string;
}

// Message and Communication Interfaces
export interface NetworkMessage {
    type: MessageType;
    sender: string;
    data: any;
    timestamp: string;
}

export interface SignalingMessage {
    type: MessageType;
    peerId?: string;
    nodeType?: NodeType;
    nodeTier?: NodeTier;
    tokenBalance?: number;
    region?: string;
    timestamp?: string;
    error?: string;
    task?: Task;
    taskId?: string;
    progress?: number;
    result?: any;
    peerInfo?: PeerInfo;
    status?: NodeStatus;
    reward?: number;
    message?: string;
    regions?: string[] | RegionSummary[];
    peers?: PeerInfo[];
    activeTasks?: number;
    completedTasks?: number;
    totalRewardsDistributed?: number;
    heartbeatId?: string;
}

export interface RegionSummary {
    id: string;
    name: string;
    peerCount: number;
    validatorCount: number;
    metrics: RegionMetrics;
}

export interface RegionalResponse {
    taskId: string;
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

// DHT Interfaces
export interface DHTConfig {
    nodeId: string;
    bootstrapNodes: string[];
    refreshInterval?: number;
    replicationFactor?: number;
    timeout?: number;
}

export interface DHTAnnouncement {
    nodeType: NodeType;
    region: string;
    endpoint: string;
}

export interface DHTNode {
    id: string;
    address: string;
    lastSeen: Date;
    metadata: any;
}

export interface PeerFilter {
    nodeType?: NodeType;
    region?: string;
    minTokens?: number;
    nodeTier?: NodeTier;
}

// Task Messages
export interface TaskAcceptanceMessage {
    taskId: string;
    regionId: string;
    validatorId: string;
    assignedNodes: number;
    timestamp: string;
}

export interface TaskRejectionMessage {
    taskId: string;
    regionId: string;
    validatorId: string;
    reason: string;
    timestamp: string;
}

export interface TaskProgressMessage {
    taskId: string;
    regionId: string;
    progress: number;
    timestamp: string;
}

export interface TaskCompletionMessage {
    taskId: string;
    regionId: string;
    result: any;
    metrics?: {
        duration: number;
        resourceUsage: {
            cpu: number;
            memory: number;
            storage: number;
        };
    };
    timestamp: string;
}

// Constants
export const TASK_TIER_REQUIREMENTS: Record<TaskType, {
    tiers: NodeTier[],
    minReward: number,
    validatorShare: number
}> = {
    model_training: {
        tiers: ['training', 'feedback'],
        minReward: 100,
        validatorShare: 10
    },
    data_processing: {
        tiers: ['aggregator', 'training', 'feedback'],
        minReward: 50,
        validatorShare: 10
    },
    storage: {
        tiers: ['inference', 'aggregator', 'training', 'feedback'],
        minReward: 20,
        validatorShare: 5
    },
    compute: {
        tiers: ['aggregator', 'training', 'feedback'],
        minReward: 75,
        validatorShare: 10
    },
    inference: {
        tiers: ['inference', 'aggregator'],
        minReward: 30,
        validatorShare: 5
    }
};