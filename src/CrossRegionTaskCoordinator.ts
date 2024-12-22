// tenzro-global-node/src/CrossRegionTaskCoordinator.ts

import { EventEmitter } from 'events';
import { DHTNetwork } from './network/DHTNetwork';
import { NetworkStateManager } from './NetworkStateManager';
import { NetworkParameterManager } from './NetworkParameters';
import { Logger } from './utils/Logger';
import { 
    CrossRegionTask, 
    TaskDistribution, 
    RegionCapacity,
    NetworkState,
    TaskType,
    NodeTier,
    CrossRegionTaskStatus,
    RegionTaskMetrics,
    ConsolidatedResult,
    TaskError
} from './types/crossRegion';
import config from './config';

interface RegionScore {
    regionId: string;
    score: number;
    capacity: number;
    performance: {
        successRate: number;
        avgResponseTime: number;
        reliability: number;
    };
}

export class CrossRegionTaskCoordinator extends EventEmitter {
    private logger: Logger;
    private activeTasks: Map<string, CrossRegionTask> = new Map();
    private taskMetrics: Map<string, Map<string, RegionTaskMetrics>> = new Map();
    private networkParams: NetworkParameterManager;

    constructor(
        private dht: DHTNetwork,
        private nodeId: string,
        private networkStateManager: NetworkStateManager
    ) {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('CrossRegionTaskCoordinator');
        this.networkParams = NetworkParameterManager.getInstance();
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.dht.on('message', this.handleDHTMessage.bind(this));
        this.networkStateManager.on('state_updated', this.handleNetworkStateUpdate.bind(this));
    }

    private async handleDHTMessage(message: any): Promise<void> {
        if (!message.data?.taskId || !this.activeTasks.has(message.data.taskId)) {
            return;
        }

        switch (message.type) {
            case 'task_progress':
                await this.updateTaskProgress(
                    message.data.taskId,
                    message.data.regionId,
                    message.data.progress
                );
                break;
            case 'task_completed':
                await this.handleRegionTaskCompletion(
                    message.data.taskId,
                    message.data.regionId,
                    message.data.result
                );
                break;
            case 'task_failed':
                await this.handleRegionTaskFailure(
                    message.data.taskId,
                    message.data.regionId,
                    message.data.error
                );
                break;
        }
    }

    private handleNetworkStateUpdate(state: NetworkState): void {
        this.updateTaskDistributions(state);
    }

    public async distributeTask(task: CrossRegionTask): Promise<TaskDistribution> {
        try {
            const networkState = await this.networkStateManager.getCurrentState();
            const distribution = await this.calculateRegionDistribution(task, networkState);
            
            if (!this.validateDistribution(distribution, task)) {
                throw new Error('Could not meet task distribution requirements');
            }

            task.regionDistribution = distribution;
            task.coordinatorId = this.nodeId;
            task.status = this.initializeTaskStatus(distribution);

            this.activeTasks.set(task.taskId, task);

            await this.dht.store(`task:${task.taskId}:distribution`, distribution);
            await this.dht.store(`task:${task.taskId}:status`, task.status);

            this.logger.info(`Task ${task.taskId} distributed across ${distribution.distribution.size} regions`);
            return distribution;

        } catch (error) {
            this.logger.error(`Failed to distribute task ${task.taskId}`, error as Error);
            throw error;
        }
    }

    private async calculateRegionDistribution(
        task: CrossRegionTask,
        networkState: NetworkState
    ): Promise<TaskDistribution> {
        const regionScores = await this.scoreRegions(task, networkState);
        return this.optimizeDistribution(task, regionScores);
    }

    private async scoreRegions(
        task: CrossRegionTask,
        networkState: NetworkState
    ): Promise<RegionScore[]> {
        const scores: RegionScore[] = [];

        for (const [regionId, capacity] of networkState.regions) {
            if (!this.regionMeetsRequirements(capacity, task)) {
                continue;
            }

            const baseScore = this.calculateBaseScore(capacity);
            const finalScore = this.applyTaskModifiers(
                baseScore,
                task,
                capacity,
                regionId
            );

            scores.push({
                regionId,
                score: finalScore,
                capacity: capacity.nodeCount.available,
                performance: capacity.performance
            });
        }

        return scores.sort((a, b) => b.score - a.score);
    }

    private regionMeetsRequirements(
        capacity: RegionCapacity,
        task: CrossRegionTask
    ): boolean {
        const params = this.networkParams.getParameters();
        
        return (
            capacity.nodeCount.available >= params.operationalLimits.minNodesPerTask &&
            capacity.nodeCount.byTier[task.requirements.nodeTier] > 0 &&
            capacity.performance.successRate >= 0.95
        );
    }

    private calculateBaseScore(capacity: RegionCapacity): number {
        return (
            capacity.performance.successRate * 40 +
            (1 - Math.min(capacity.performance.avgResponseTime / 1000, 1)) * 30 +
            capacity.performance.reliability * 30
        );
    }

    private applyTaskModifiers(
        baseScore: number,
        task: CrossRegionTask,
        capacity: RegionCapacity,
        regionId: string
    ): number {
        let score = baseScore;

        const capacityRatio = capacity.nodeCount.available / capacity.nodeCount.total;
        score *= (0.5 + 0.5 * capacityRatio);

        if (task.type === 'model_training' && capacity.nodeCount.byTier['training'] > 0) {
            score *= 1.2;
        }

        const taskHistory = this.taskMetrics.get(task.type)?.get(regionId);
        if (taskHistory) {
            score *= (0.7 + 0.3 * taskHistory.completionRate);
        }

        const loadFactor = capacity.taskCount.active / capacity.nodeCount.total;
        score *= (1 - loadFactor * 0.5);

        return score;
    }

    private optimizeDistribution(
        task: CrossRegionTask,
        regionScores: RegionScore[]
    ): TaskDistribution {
        const distribution = new Map<string, number>();
        let remainingNodes = task.requirements.maxNodes;
        const params = this.networkParams.getParameters();

        for (const region of regionScores) {
            if (remainingNodes <= 0) break;

            const nodeCount = Math.min(
                Math.ceil(remainingNodes * (region.score / 100)),
                region.capacity,
                params.crossRegionLimits.maxNodesPerRegion,
                remainingNodes
            );

            if (nodeCount >= params.crossRegionLimits.minNodesPerRegion) {
                distribution.set(region.regionId, nodeCount);
                remainingNodes -= nodeCount;
            }
        }

        return {
            distribution,
            timestamp: new Date().toISOString(),
            totalNodes: task.requirements.maxNodes - remainingNodes
        };
    }

    private validateDistribution(
        distribution: TaskDistribution,
        task: CrossRegionTask
    ): boolean {
        const params = this.networkParams.getParameters();
        
        if (distribution.distribution.size < params.crossRegionLimits.minRegionsPerTask ||
            distribution.distribution.size > params.crossRegionLimits.maxRegionsPerTask) {
            return false;
        }

        for (const nodeCount of distribution.distribution.values()) {
            if (nodeCount < params.crossRegionLimits.minNodesPerRegion ||
                nodeCount > params.crossRegionLimits.maxNodesPerRegion) {
                return false;
            }
        }

        return distribution.totalNodes >= task.requirements.minNodes;
    }

    private initializeTaskStatus(distribution: TaskDistribution): CrossRegionTaskStatus {
        return {
            state: 'pending',
            regionalProgress: new Map(
                Array.from(distribution.distribution.keys()).map(region => [region, 0])
            ),
            consolidationRequired: true,
            timestamp: new Date().toISOString(),
            errors: []
        };
    }

    public async updateTaskProgress(
        taskId: string,
        regionId: string,
        progress: number
    ): Promise<void> {
        const task = this.activeTasks.get(taskId);
        if (!task) return;

        task.status.regionalProgress.set(regionId, progress);

        const totalProgress = Array.from(task.status.regionalProgress.values())
            .reduce((sum, p) => sum + p, 0) / task.status.regionalProgress.size;

        task.status.state = totalProgress === 100 ? 'completed' : 'processing';
        
        await this.dht.store(`task:${taskId}:status`, task.status);
        this.emit('task_progress', taskId, totalProgress);

        if (totalProgress === 100) {
            await this.handleTaskCompletion(task);
        }
    }

    private async handleRegionTaskCompletion(
        taskId: string,
        regionId: string,
        result: any
    ): Promise<void> {
        const task = this.activeTasks.get(taskId);
        if (!task) return;

        await this.dht.store(`task:${taskId}:result:${regionId}`, result);

        task.status.regionsCompleted = task.status.regionsCompleted || new Set();
        task.status.regionsCompleted.add(regionId);

        this.updateRegionMetrics(task.type, regionId, {
            completionRate: 1,
            averageLatency: Date.now() - new Date(task.timestamp).getTime(),
            resourceUtilization: 1,
            failureRate: 0,
            performance: {
                successRate: 1,
                avgResponseTime: Date.now() - new Date(task.timestamp).getTime(),
                reliability: 1
            },
            timestamp: new Date().toISOString()
        });

        if (task.status.regionsCompleted.size === task.regionDistribution?.distribution.size) {
            await this.handleTaskCompletion(task);
        }
    }

    private async handleRegionTaskFailure(
        taskId: string,
        regionId: string,
        error: string
    ): Promise<void> {
        const task = this.activeTasks.get(taskId);
        if (!task) return;

        const taskError: TaskError = {
            regionId,
            error,
            timestamp: new Date().toISOString()
        };

        task.status.errors = task.status.errors || [];
        task.status.errors.push(taskError);

        this.updateRegionMetrics(task.type, regionId, {
            completionRate: 0,
            averageLatency: Date.now() - new Date(task.timestamp).getTime(),
            resourceUtilization: 0,
            failureRate: 1,
            performance: {
                successRate: 0,
                avgResponseTime: Date.now() - new Date(task.timestamp).getTime(),
                reliability: 0
            },
            timestamp: new Date().toISOString()
        });

        const remainingRegions = Array.from(task.regionDistribution?.distribution.keys() || [])
            .filter(region => region !== regionId);

        if (remainingRegions.length < this.networkParams.getParameters().crossRegionLimits.minRegionsPerTask) {
            await this.handleTaskFailure(task, new Error(`Insufficient regions after failure of ${regionId}`));
        } else {
            const newDistribution = new Map(task.regionDistribution?.distribution || new Map());
            newDistribution.delete(regionId);
            
            task.regionDistribution = {
                distribution: newDistribution,
                timestamp: new Date().toISOString(),
                totalNodes: Array.from(newDistribution.values()).reduce((sum, n) => sum + n, 0)
            };

            await this.dht.store(`task:${taskId}:distribution`, task.regionDistribution);
        }
    }

    private async handleTaskCompletion(task: CrossRegionTask): Promise<void> {
        try {
            // Collect results from all regions
            const results = new Map<string, any>();
            for (const [regionId] of task.regionDistribution?.distribution || new Map()) {
                const result = await this.dht.findValue(`task:${task.taskId}:result:${regionId}`);
                if (result) {
                    results.set(regionId, result);
                }
            }
    
            // If consolidation is required, perform it
            if (task.status.consolidationRequired) {
                try {
                    task.status.consolidationStatus = 'in_progress';
                    await this.dht.store(`task:${task.taskId}:status`, task.status);
    
                    const consolidatedResult = await this.performConsolidation(task.type, results);
                    await this.dht.store(`task:${task.taskId}:result:consolidated`, consolidatedResult);
    
                    task.status.consolidationStatus = 'completed';
                } catch (error) {
                    task.status.consolidationStatus = 'failed';
                    if (task.status.errors) {
                        task.status.errors.push({
                            regionId: 'consolidation',
                            error: error instanceof Error ? error.message : 'Consolidation failed',
                            timestamp: new Date().toISOString()
                        });
                    }
                    throw error;
                }
            }
    
            // Update task final status
            task.status.state = 'completed';
            await this.dht.store(`task:${task.taskId}:status`, task.status);
    
            // Store final metrics
            const completionMetrics = {
                totalTime: Date.now() - new Date(task.timestamp).getTime(),
                regionsUsed: results.size,
                totalNodes: task.regionDistribution?.totalNodes || 0,
                consolidationPerformed: task.status.consolidationRequired,
                timestamp: new Date().toISOString()
            };
            await this.dht.store(`task:${task.taskId}:metrics`, completionMetrics);
    
            // Clean up task from active tasks
            this.activeTasks.delete(task.taskId);
    
            // Emit completion event with results
            this.emit('task_completed', task.taskId, {
                results,
                consolidationStatus: task.status.consolidationStatus,
                metrics: completionMetrics
            });
    
        } catch (error) {
            this.logger.error(`Failed to handle completion for task ${task.taskId}`, error as Error);
            await this.handleTaskFailure(task, error as Error);
        }
    }

    private async handleTaskFailure(task: CrossRegionTask, error: Error): Promise<void> {
        try {
            task.status.state = 'failed';
            if (task.status.errors) {
                task.status.errors.push({
                    regionId: 'global',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
            await this.dht.store(`task:${task.taskId}:status`, task.status);

            this.activeTasks.delete(task.taskId);
            this.emit('task_failed', task.taskId, error);

        } catch (err) {
            this.logger.error(`Error handling task failure for ${task.taskId}`, err as Error);
        }
    }

    private updateRegionMetrics(
        taskType: TaskType,
        regionId: string,
        metrics: RegionTaskMetrics
    ): void {
        if (!this.taskMetrics.has(taskType)) {
            this.taskMetrics.set(taskType, new Map());
        }
        
        const typeMetrics = this.taskMetrics.get(taskType)!;
        typeMetrics.set(regionId, metrics);
    }

    private async consolidateResults(
        task: CrossRegionTask,
        results: Map<string, any>
    ): Promise<void> {
        try {
            task.status.consolidationStatus = 'in_progress';
            await this.dht.store(`task:${task.taskId}:status`, task.status);

            const consolidatedResult = await this.performConsolidation(task.type, results);
            await this.dht.store(`task:${task.taskId}:result`, consolidatedResult);

            task.status.consolidationStatus = 'completed';
            await this.dht.store(`task:${task.taskId}:status`, task.status);

        } catch (error) {
            task.status.consolidationStatus = 'failed';
            if (task.status.errors) {
                task.status.errors.push({
                    regionId: 'consolidation',
                    error: error instanceof Error ? error.message : 'Unknown consolidation error',
                    timestamp: new Date().toISOString()
                });
            }
            await this.dht.store(`task:${task.taskId}:status`, task.status);
            throw error;
        }
    }

    private async performConsolidation(
        taskType: TaskType,
        results: Map<string, any>
    ): Promise<ConsolidatedResult> {
        const startTime = Date.now();
        const regions = Array.from(results.keys());
        let consolidatedData: any;

        switch (taskType) {
            case 'model_training':
                consolidatedData = await this.consolidateModelTrainingResults(results);
                break;
            case 'data_processing':
                consolidatedData = await this.consolidateDataProcessingResults(results);
                break;
            case 'compute':
                consolidatedData = await this.consolidateComputeResults(results);
                break;
            default:
                consolidatedData = Array.from(results.values());
        }

        return {
            type: this.getConsolidationType(taskType),
            data: consolidatedData,
            timestamp: new Date().toISOString(),
            metadata: {
                regions,
                metrics: {
                    totalTime: Date.now() - startTime,
                    nodesUsed: results.size
                }
            }
        };
    }

    private getConsolidationType(taskType: TaskType): 'ensemble' | 'aggregated_data' | 'computed_result' {
        switch (taskType) {
            case 'model_training':
                return 'ensemble';
            case 'data_processing':
                return 'aggregated_data';
            default:
                return 'computed_result';
        }
    }

    private async consolidateModelTrainingResults(results: Map<string, any>): Promise<any> {
        const modelParams = Array.from(results.values());
        return {
            type: 'ensemble',
            models: modelParams,
            ensembleMethod: 'weighted_average',
            weights: this.calculateModelWeights(results),
            timestamp: new Date().toISOString()
        };
    }

    private calculateModelWeights(results: Map<string, any>): Map<string, number> {
        const weights = new Map<string, number>();
        const totalRegions = results.size;

        for (const [regionId] of results) {
            const regionMetrics = this.taskMetrics.get('model_training')?.get(regionId);
            const weight = regionMetrics 
                ? (regionMetrics.performance.successRate + regionMetrics.performance.reliability) / 2
                : 1 / totalRegions;
            weights.set(regionId, weight);
        }

        // Normalize weights
        const totalWeight = Array.from(weights.values()).reduce((sum, w) => sum + w, 0);
        for (const [regionId, weight] of weights) {
            weights.set(regionId, weight / totalWeight);
        }

        return weights;
    }

    private async consolidateDataProcessingResults(results: Map<string, any>): Promise<any> {
        const processedData = Array.from(results.values());
        return {
            type: 'aggregated_data',
            data: processedData,
            aggregationMethod: 'merge',
            timestamp: new Date().toISOString()
        };
    }

    private async consolidateComputeResults(results: Map<string, any>): Promise<any> {
        const computeResults = Array.from(results.values());
        return {
            type: 'computed_result',
            results: computeResults,
            combinationMethod: 'reduce',
            timestamp: new Date().toISOString()
        };
    }

    private async updateTaskDistributions(networkState: NetworkState): Promise<void> {
        for (const task of this.activeTasks.values()) {
            await this.checkAndUpdateDistribution(task, networkState);
        }
    }

    private async checkAndUpdateDistribution(
        task: CrossRegionTask,
        networkState: NetworkState
    ): Promise<void> {
        if (!task.regionDistribution) return;

        const params = this.networkParams.getParameters();
        let needsRedistribution = false;

        for (const [regionId, nodeCount] of task.regionDistribution.distribution) {
            const regionCapacity = networkState.regions.get(regionId);
            if (!regionCapacity || 
                regionCapacity.nodeCount.available < params.crossRegionLimits.minNodesPerRegion) {
                needsRedistribution = true;
                break;
            }
        }

        if (needsRedistribution) {
            try {
                const newDistribution = await this.calculateRegionDistribution(task, networkState);
                task.regionDistribution = newDistribution;
                await this.dht.store(`task:${task.taskId}:distribution`, newDistribution);
                this.emit('task_redistributed', task.taskId, newDistribution);
            } catch (error) {
                this.logger.error(`Failed to redistribute task ${task.taskId}`, error as Error);
            }
        }
    }

    public async stop(): Promise<void> {
        try {
            const activeTaskPromises = Array.from(this.activeTasks.values()).map(task => 
                this.handleTaskFailure(task, new Error('Coordinator stopping'))
            );

            await Promise.all(activeTaskPromises);
            this.activeTasks.clear();
            this.taskMetrics.clear();
            this.removeAllListeners();
            
        } catch (error) {
            this.logger.error('Error stopping cross-region coordinator', error as Error);
            throw error;
        }
    }

    // Public methods
    public isTaskActive(taskId: string): boolean {
        return this.activeTasks.has(taskId);
    }

    public async getTaskStatus(taskId: string): Promise<CrossRegionTaskStatus | null> {
        try {
            return await this.dht.findValue(`task:${taskId}:status`);
        } catch (error) {
            this.logger.error(`Failed to get status for task ${taskId}`, error as Error);
            return null;
        }
    }

    public async getTaskDistribution(taskId: string): Promise<TaskDistribution | null> {
        try {
            return await this.dht.findValue(`task:${taskId}:distribution`);
        } catch (error) {
            this.logger.error(`Failed to get distribution for task ${taskId}`, error as Error);
            return null;
        }
    }

    public getActiveTaskCount(): number {
        return this.activeTasks.size;
    }

    public getRegionMetrics(taskType: TaskType, regionId: string): RegionTaskMetrics | undefined {
        return this.taskMetrics.get(taskType)?.get(regionId);
    }
}

export default CrossRegionTaskCoordinator;