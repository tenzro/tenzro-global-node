// tenzro-global-node/src/NetworkStateManager.ts

import { EventEmitter } from 'events';
import { DHTNetwork } from './network/DHTNetwork';
import { Logger } from './utils/Logger';
import { NetworkState, RegionCapacity } from './types/index';
import config from './config';

export class NetworkStateManager extends EventEmitter {
    private currentState: NetworkState;
    private updateInterval: NodeJS.Timeout | undefined;
    private logger: Logger;

    constructor(
        private dht: DHTNetwork,
        private nodeId: string
    ) {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('NetworkStateManager');
        this.currentState = this.initializeNetworkState();
        this.startPeriodicUpdates();
    }

    private initializeNetworkState(): NetworkState {
        return {
            regions: new Map(),
            globalMetrics: {
                totalNodes: 0,
                activeNodes: 0,
                taskSuccess: 0,
                avgResponseTime: 0,
                currentLoad: 0
            },
            timestamp: new Date().toISOString()
        };
    }

    private startPeriodicUpdates(): void {
        this.updateInterval = setInterval(
            () => this.updateNetworkState(),
            config.metrics.updateInterval
        );
    }

    public async updateNetworkState(): Promise<void> {
        try {
            // Get all regional validators
            const regionalValidators = await this.dht.getPeers({
                nodeType: 'regional_node'
            });

            // Clear current regions
            this.currentState.regions.clear();

            // Update each region's state
            await Promise.all(regionalValidators.map(async validator => {
                try {
                    const regionMetrics = await this.dht.findValue(`region:${validator.metadata.region}:metrics`);
                    if (regionMetrics) {
                        this.currentState.regions.set(validator.metadata.region, regionMetrics);
                    }
                } catch (error) {
                    this.logger.warn(`Failed to get metrics for region ${validator.metadata.region}`, error as Error);
                }
            }));

            // Update global metrics
            this.updateGlobalMetrics();

            // Update timestamp
            this.currentState.timestamp = new Date().toISOString();

            // Store state in DHT for other global nodes
            await this.dht.store(`network:state:${this.nodeId}`, this.currentState);

            // Emit state update event
            this.emit('state_updated', this.currentState);

        } catch (error) {
            this.logger.error('Failed to update network state', error as Error);
        }
    }

    private updateGlobalMetrics(): void {
        let totalNodes = 0;
        let activeNodes = 0;
        let totalTasks = 0;
        let completedTasks = 0;
        let totalResponseTime = 0;
        let responseTimeCount = 0;

        for (const region of this.currentState.regions.values()) {
            totalNodes += region.nodeCount.total;
            activeNodes += region.nodeCount.available;

            if (region.taskCount) {
                totalTasks += region.taskCount.active + region.taskCount.completed;
                completedTasks += region.taskCount.completed;
            }

            if (region.performance && region.performance.avgResponseTime) {
                totalResponseTime += region.performance.avgResponseTime;
                responseTimeCount++;
            }
        }

        this.currentState.globalMetrics = {
            totalNodes,
            activeNodes,
            taskSuccess: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
            avgResponseTime: responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0,
            currentLoad: activeNodes / totalNodes
        };
    }

    public async syncWithPeers(): Promise<void> {
        try {
            // Get states from other global validators
            const globalValidators = await this.dht.getPeers({
                nodeType: 'global_node'
            });

            const peerStates = await Promise.all(
                globalValidators
                    .filter(v => v.id !== this.nodeId)
                    .map(async v => {
                        try {
                            return await this.dht.findValue(`network:state:${v.id}`);
                        } catch {
                            return null;
                        }
                    })
            );

            // Merge valid states
            const validStates = peerStates.filter((state): state is NetworkState => 
                state !== null && this.isValidState(state)
            );

            if (validStates.length > 0) {
                this.mergeStates(validStates);
            }

        } catch (error) {
            this.logger.error('Failed to sync with peers', error as Error);
        }
    }

    private isValidState(state: any): state is NetworkState {
        return (
            state &&
            state.regions instanceof Map &&
            typeof state.globalMetrics === 'object' &&
            typeof state.timestamp === 'string'
        );
    }

    private mergeStates(states: NetworkState[]): void {
        // Sort states by timestamp, newest first
        states.sort((a, b) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        // Merge regions
        for (const state of states) {
            for (const [regionId, capacity] of state.regions) {
                if (!this.currentState.regions.has(regionId)) {
                    this.currentState.regions.set(regionId, capacity);
                }
            }
        }

        // Update global metrics after merge
        this.updateGlobalMetrics();
        this.currentState.timestamp = new Date().toISOString();
    }

    public async getRegionalCapacity(regionId: string): Promise<RegionCapacity | null> {
        return this.currentState.regions.get(regionId) || null;
    }

    public getCurrentState(): NetworkState {
        return {
            regions: new Map(this.currentState.regions),
            globalMetrics: { ...this.currentState.globalMetrics },
            timestamp: this.currentState.timestamp
        };
    }

    public async stop(): Promise<void> {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.removeAllListeners();
    }
}

export default NetworkStateManager;