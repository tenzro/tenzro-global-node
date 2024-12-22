// src/GlobalNodeManager.ts

import { EventEmitter } from 'events';
import { DHTNetwork } from './network/DHTNetwork';
import { NetworkStateManager } from './NetworkStateManager';
import { TaskBroadcastManager } from './TaskBroadcastManager';
import { CrossRegionTaskCoordinator } from './CrossRegionTaskCoordinator';
import { NetworkParameterManager } from './NetworkParameters';
import { Logger } from './utils/Logger';
import { 
    NetworkMessage,
    DHTAnnouncement,
} from './types/index';
import {
    Task,
    CrossRegionTask,
    TaskBroadcast,
    NetworkState
} from './types/crossRegion';
import config from './config';


export class GlobalNodeManager extends EventEmitter {
    private taskBroadcastManager: TaskBroadcastManager;
    private networkStateManager: NetworkStateManager;
    private crossRegionCoordinator: CrossRegionTaskCoordinator;
    private networkParams: NetworkParameterManager;
    private logger: Logger;
    private active: boolean = false;

    constructor(
        private dht: DHTNetwork,
        private nodeId: string,
        private region: string,
        private tokenBalance: number
    ) {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('GlobalNodeManager');

        // Initialize managers
        this.networkStateManager = new NetworkStateManager(dht, nodeId);
        this.taskBroadcastManager = new TaskBroadcastManager(dht, nodeId);
        this.crossRegionCoordinator = new CrossRegionTaskCoordinator(dht, nodeId, this.networkStateManager);
        this.networkParams = NetworkParameterManager.getInstance();

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // DHT messages
        this.dht.on('message', this.handleDHTMessage.bind(this));

        // Task-related events
        this.taskBroadcastManager.on('task_distributed', this.handleTaskDistributed.bind(this));
        this.taskBroadcastManager.on('task_completed', this.handleTaskCompleted.bind(this));

        // Network state events
        this.networkStateManager.on('state_updated', this.handleNetworkStateUpdate.bind(this));

        // Cross-region events
        this.crossRegionCoordinator.on('task_progress', this.handleCrossRegionProgress.bind(this));
        this.crossRegionCoordinator.on('task_completed', this.handleCrossRegionCompleted.bind(this));
        this.crossRegionCoordinator.on('task_failed', this.handleCrossRegionFailed.bind(this));

        // Network parameter events
        this.networkParams.on('parameters_updated', this.handleParameterUpdate.bind(this));
        this.networkParams.on('parameters_fetch_failed', this.handleParameterFetchFailure.bind(this));
    }

    public async start(): Promise<void> {
        try {
            // Validate stake requirement
            if (!this.networkParams.isValidatorStakeEnough(this.tokenBalance, true)) {
                throw new Error(`Insufficient tokens for global validator. Required: ${
                    this.networkParams.getParameters().validatorRequirements.globalNodeStake
                }, Have: ${this.tokenBalance}`);
            }

            // Start network parameter updates
            await this.networkParams.startParameterUpdates();

            // Join DHT network
            await this.dht.join();

            // Announce presence
            const announcement: DHTAnnouncement = {
                nodeType: 'global_node',
                region: this.region,
                endpoint: `${this.nodeId}`
            };

            await this.dht.announce(announcement);

            // Start network state monitoring
            await this.networkStateManager.updateNetworkState();

            this.active = true;
            this.logger.info('Global node manager started successfully');

        } catch (error) {
            this.logger.error('Failed to start global node manager', error as Error);
            throw error;
        }
    }

    private async handleDHTMessage(message: NetworkMessage): Promise<void> {
        if (!this.active) return;

        try {
            switch (message.type) {
                case 'task_broadcast':
                    await this.handleIncomingTask(message.data as TaskBroadcast);
                    break;
                case 'network_state':
                    await this.networkStateManager.updateNetworkState();
                    break;
                default:
                    this.taskBroadcastManager.emit('message', message);
            }
        } catch (error) {
            this.logger.error(`Error handling message type ${message.type}`, error as Error);
        }
    }

    private async handleIncomingTask(task: TaskBroadcast): Promise<void> {
        try {
            // Validate task parameters using network parameters
            if (!this.validateTaskParameters(task)) {
                throw new Error('Task parameters validation failed');
            }

            // Check if task is cross-region
            if (this.requiresCrossRegionCoordination(task)) {
                await this.handleCrossRegionTask(task as unknown as CrossRegionTask);
                return;
            }

            // Regular task handling
            await this.handleRegularTask(task);

        } catch (error) {
            this.logger.error(`Failed to handle task ${task.taskId}`, error as Error);
            await this.notifyTaskFailure(task, error as Error);
        }
    }

    private validateTaskParameters(task: Task): boolean {
        try {
            // Duration validation
            if (!this.networkParams.isTaskDurationValid(task.requirements.duration.maximum)) {
                return false;
            }

            // Budget validation
            const taskFee = this.networkParams.getTaskFee(task.budget.maxAmount);
            if (taskFee <= 0) {
                return false;
            }

            // Node requirements validation
            const params = this.networkParams.getParameters();
            if (task.requirements.maxNodes > params.operationalLimits.maxNodesPerTask ||
                task.requirements.minNodes < params.operationalLimits.minNodesPerTask) {
                return false;
            }

            return true;
        } catch (error) {
            this.logger.error('Task validation error', error as Error);
            return false;
        }
    }

    private requiresCrossRegionCoordination(task: Task): boolean {
        const params = this.networkParams.getParameters();
        
        return (
            task.requirements.maxNodes > params.crossRegionLimits.maxNodesPerRegion ||
            task.requirements.constraints?.region?.length !== 1 ||
            task.type === 'model_training'
        );
    }

    private async handleCrossRegionTask(task: CrossRegionTask): Promise<void> {
        try {
            await this.crossRegionCoordinator.distributeTask(task);
            this.logger.info(`Cross-region task ${task.taskId} distribution initiated`);
        } catch (error) {
            this.logger.error(`Failed to handle cross-region task ${task.taskId}`, error as Error);
            await this.notifyTaskFailure(task, error as Error);
        }
    }

    private async handleRegularTask(task: Task): Promise<void> {
        try {
            const shouldHandle = await this.shouldHandleTask(task);
            if (!shouldHandle) return;

            const networkState = await this.networkStateManager.getCurrentState();
            
            if (!this.verifyNetworkCapacity(task, networkState)) {
                throw new Error('Insufficient network capacity for task');
            }

            await this.taskBroadcastManager.broadcastTask(task as TaskBroadcast);
            this.logger.info(`Task ${task.taskId} accepted for processing`);

        } catch (error) {
            this.logger.error(`Failed to handle regular task ${task.taskId}`, error as Error);
            await this.notifyTaskFailure(task, error as Error);
        }
    }

    private async shouldHandleTask(task: Task): Promise<boolean> {
        const taskState = await this.dht.findValue(`task:${task.taskId}:state`);
        if (taskState && taskState.handler && taskState.handler !== this.nodeId) {
            return false;
        }

        await this.dht.store(`task:${task.taskId}:state`, {
            handler: this.nodeId,
            timestamp: new Date().toISOString()
        });

        return true;
    }

    private verifyNetworkCapacity(task: Task, state: NetworkState): boolean {
        let availableNodes = 0;
        const requiredTier = task.requirements.nodeTier;

        for (const region of state.regions.values()) {
            availableNodes += region.nodeCount.byTier[requiredTier] || 0;
        }

        return availableNodes >= task.requirements.minNodes;
    }

    private async handleTaskDistributed(taskId: string): Promise<void> {
        await this.dht.store(`task:${taskId}:state`, {
            status: 'distributed',
            handler: this.nodeId,
            timestamp: new Date().toISOString()
        });
    }

    private async handleTaskCompleted(taskId: string, result: any): Promise<void> {
        await this.dht.store(`task:${taskId}:state`, {
            status: 'completed',
            result,
            handler: this.nodeId,
            timestamp: new Date().toISOString()
        });
    }

    private handleNetworkStateUpdate(state: NetworkState): void {
        this.emit('network_state_updated', state);
    }

    private async handleCrossRegionProgress(taskId: string, progress: number): Promise<void> {
        await this.dht.store(`task:${taskId}:progress`, {
            progress,
            timestamp: new Date().toISOString()
        });
    }

    private async handleCrossRegionCompleted(taskId: string, results: any): Promise<void> {
        await this.handleTaskCompleted(taskId, results);
    }

    private async handleCrossRegionFailed(taskId: string, error: Error): Promise<void> {
        const task = await this.dht.findValue(`task:${taskId}:state`);
        if (task) {
            await this.notifyTaskFailure(task, error);
        }
    }

    private handleParameterUpdate(newParams: any): void {
        this.logger.info('Network parameters updated', newParams);
        // Implement any necessary changes based on new parameters
    }

    private handleParameterFetchFailure(): void {
        this.logger.warn('Failed to fetch network parameters, using last known good configuration');
    }

    private async notifyTaskFailure(task: Task, error: Error): Promise<void> {
        const message: NetworkMessage = {
            type: 'task_failed',
            sender: this.nodeId,
            data: {
                taskId: task.taskId,
                error: error.message,
                timestamp: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
        };

        try {
            await this.dht.sendMessage(task.source.nodeId, message);
        } catch (error) {
            this.logger.error(`Failed to notify task failure for ${task.taskId}`, error as Error);
        }
    }

    public async stop(): Promise<void> {
        try {
            this.active = false;

            // Stop all managers
            await this.networkParams.stopParameterUpdates();
            await this.taskBroadcastManager.stop();
            await this.networkStateManager.stop();
            await this.crossRegionCoordinator.stop();

            // Leave DHT network
            await this.dht.leave();

            // Clean up event listeners
            this.removeAllListeners();

            this.logger.info('Global node manager stopped successfully');
        } catch (error) {
            this.logger.error('Error stopping global node manager', error as Error);
            throw error;
        }
    }

    // Public API methods
    public async getNetworkState(): Promise<NetworkState> {
        return this.networkStateManager.getCurrentState();
    }

    public isActive(): boolean {
        return this.active;
    }

    public getNodeId(): string {
        return this.nodeId;
    }

    public getRegion(): string {
        return this.region;
    }

    public getNetworkParameters() {
        return this.networkParams.getParameters();
    }
}

export default GlobalNodeManager;