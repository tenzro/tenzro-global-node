// tenzro-global-node/src/GlobalTaskCoordinator.ts

import { EventEmitter } from 'events';
import { DHTNetwork } from './network/DHTNetwork';
import { TaskBroadcastManager } from './TaskBroadcastManager';
import { NetworkStateManager } from './NetworkStateManager';
import { Logger } from './utils/Logger';
import { RegionCapacity, TaskBroadcast, NetworkState } from './types/index';

export class GlobalTaskCoordinator extends EventEmitter {
    private logger: Logger;
    private broadcastManager: TaskBroadcastManager;
    private networkState: NetworkStateManager;
    handleDHTMessage: any;
    handleTaskDistribution: any;

    constructor(
        private dht: DHTNetwork,
        private nodeId: string
    ) {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('GlobalTaskCoordinator');
        this.broadcastManager = new TaskBroadcastManager(dht, nodeId);
        this.networkState = new NetworkStateManager(dht, nodeId);
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.dht.on('message', this.handleDHTMessage.bind(this));
        this.broadcastManager.on('task_distributed', this.handleTaskDistribution.bind(this));
        this.networkState.on('state_updated', this.handleNetworkStateUpdate.bind(this));
    }

    public async handleIncomingTask(task: TaskBroadcast): Promise<void> {
        try {
            // Validate network capacity
            const networkState = await this.networkState.getCurrentState();
            if (!this.canNetworkHandleTask(task, networkState)) {
                throw new Error('Network capacity insufficient for task');
            }

            // Broadcast task
            await this.broadcastManager.broadcastTask(task);
            this.logger.info(`Task ${task.taskId} accepted for processing`);

        } catch (error) {
            this.logger.error(`Failed to handle incoming task ${task.taskId}`, error as Error);
            throw error;
        }
    }

    private canNetworkHandleTask(task: TaskBroadcast, state: NetworkState): boolean {
        const requiredTier = task.requirements.nodeTier;
        let availableNodes = 0;

        for (const region of state.regions.values()) {
            availableNodes += region.nodeCount.byTier[requiredTier] || 0;
        }

        return availableNodes >= task.requirements.minNodes;
    }

    private async handleNetworkStateUpdate(state: NetworkState): Promise<void> {
        // Update regional capacities
        for (const [regionId, capacity] of state.regions) {
            await this.updateRegionalMetrics(regionId, capacity);
        }
    }

    private async updateRegionalMetrics(regionId: string, capacity: RegionCapacity): Promise<void> {
        // Update DHT with latest regional metrics
        await this.dht.store(`region:${regionId}:metrics`, {
            capacity,
            timestamp: new Date().toISOString()
        });
    }

    public async getRegionalCapacity(regionId: string): Promise<RegionCapacity | null> {
        try {
            const data = await this.dht.findValue(`region:${regionId}:metrics`);
            return data ? data.capacity : null;
        } catch (error) {
            this.logger.error(`Failed to get capacity for region ${regionId}`, error as Error);
            return null;
        }
    }

    public async stop(): Promise<void> {
        await this.broadcastManager.stop();
        await this.networkState.stop();
        this.removeAllListeners();
    }
}