// tenzro-global-node/src/NetworkParameterManager.ts

import { EventEmitter } from 'events';
import { Logger } from './utils/Logger';
import { NetworkParameters } from './types/index';
import config from './config';

export class NetworkParameterManager extends EventEmitter {
    private static instance: NetworkParameterManager;
    private parameters: NetworkParameters;
    private logger: Logger;
    private updateInterval: NodeJS.Timeout | null = null;
    private lastUpdate: Date = new Date();
    private retryCount: number = 0;

    private constructor() {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('NetworkParameterManager');
        this.parameters = this.getDefaultParameters();
    }

    private getDefaultParameters(): NetworkParameters {
        return {
            validatorRequirements: {
                globalNodeStake: parseInt(process.env.GLOBAL_NODE_STAKE || '10000', 10),
                regionalNodeStake: parseInt(process.env.REGIONAL_NODE_STAKE || '5000', 10),
                minUptime: 0,
                minReliability: 0
            },
            networkEconomics: {
                taskFeePercentage: 1.0,
                validatorRewardShare: 50,
                minimumTaskValue: 100,
                penaltyRates: {
                    slaBreachPenalty: 0,
                    taskFailurePenalty: 0
                }
            },
            operationalLimits: {
                maxTaskDuration: parseInt(process.env.MAX_TASK_DURATION || '86400', 10),
                minTaskDuration: parseInt(process.env.MIN_TASK_DURATION || '60', 10),
                maxNodesPerTask: parseInt(process.env.MAX_NODES_PER_TASK || '100', 10),
                minNodesPerTask: parseInt(process.env.MIN_NODES_PER_TASK || '2', 10),
                maxConcurrentTasks: 1000,
                maxRetries: 3
            },
            crossRegionLimits: {
                minRegionsPerTask: 2,
                maxRegionsPerTask: 10,
                minNodesPerRegion: 2,
                maxNodesPerRegion: 50,
                maxCrossRegionLatency: 1000,
                minRegionReliability: 0.95
            }
        };
    }

    public static getInstance(): NetworkParameterManager {
        if (!NetworkParameterManager.instance) {
            NetworkParameterManager.instance = new NetworkParameterManager();
        }
        return NetworkParameterManager.instance;
    }

    public async startParameterUpdates(): Promise<void> {
        // Always start with default parameters to ensure basic functionality
        this.parameters = this.getDefaultParameters();
        this.emit('parameters_updated', this.parameters);

        // Check if we should fetch remote parameters
        if (process.env.NODE_ENV === 'development' || !process.env.PARAMETER_ENDPOINT) {
            this.logger.info('Using default parameters');
            return;
        }

        if (this.updateInterval) return;

        // Wait for startup delay if configured
        if (process.env.START_DELAY) {
            const delay = parseInt(process.env.START_DELAY, 10);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        try {
            // Initial fetch with fallback
            try {
                await this.fetchLatestParameters();
            } catch (error) {
                this.logger.warn('Initial parameter fetch failed, continuing with defaults', error as Error);
            }

            // Setup recurring updates with error handling
            this.updateInterval = setInterval(() => {
                this.fetchLatestParameters().catch(error => {
                    this.logger.warn('Parameter update failed, using previous values', error as Error);
                });
            }, config.parameters.updateInterval);

        } catch (error) {
            this.logger.warn('Parameter update setup failed, using defaults', error as Error);
        }
    }

    private async fetchLatestParameters(): Promise<void> {
        try {
            if (!process.env.PARAMETER_ENDPOINT) {
                throw new Error('No parameter endpoint configured');
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

            const response = await fetch(process.env.PARAMETER_ENDPOINT, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'x-node-id': process.env.NODE_ID || '',
                    'x-node-type': process.env.NODE_TYPE || 'global_node'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Failed to fetch parameters: ${response.statusText}`);
            }

            const newParameters = await response.json() as NetworkParameters;
            
            if (this.validateParameters(newParameters)) {
                this.parameters = newParameters;
                this.lastUpdate = new Date();
                this.emit('parameters_updated', this.parameters);
                this.logger.info('Network parameters updated successfully');
                this.retryCount = 0;
            } else {
                throw new Error('Invalid parameters received');
            }

        } catch (error) {
            this.retryCount++;
            if (this.retryCount < config.parameters.retryAttempts) {
                const delay = config.parameters.retryDelay * Math.pow(2, this.retryCount - 1);
                this.logger.info(`Parameter fetch failed, retrying in ${delay}ms (attempt ${this.retryCount}/${config.parameters.retryAttempts})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                throw error; // Re-throw to trigger retry
            } else {
                this.logger.warn('Max retry attempts reached, continuing with current parameters');
                this.emit('parameters_fetch_failed');
            }
        }
    }

    public stopParameterUpdates(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.retryCount = 0;
    }

    // Rest of your existing methods remain the same
    private validateParameters(params: NetworkParameters): boolean {
        try {
            return (
                this.validateValidatorRequirements(params.validatorRequirements) &&
                this.validateNetworkEconomics(params.networkEconomics) &&
                this.validateOperationalLimits(params.operationalLimits) &&
                this.validateCrossRegionLimits(params.crossRegionLimits)
            );
        } catch (error) {
            this.logger.error('Parameter validation failed', error as Error);
            return false;
        }
    }

    private validateValidatorRequirements(requirements: NetworkParameters['validatorRequirements']): boolean {
        return (
            requirements.globalNodeStake > 0 &&
            requirements.regionalNodeStake > 0 &&
            requirements.minUptime >= 0 &&
            requirements.minUptime <= 100 &&
            requirements.minReliability >= 0 &&
            requirements.minReliability <= 1
        );
    }

    private validateNetworkEconomics(economics: NetworkParameters['networkEconomics']): boolean {
        return (
            economics.taskFeePercentage > 0 &&
            economics.taskFeePercentage <= 100 &&
            economics.validatorRewardShare > 0 &&
            economics.validatorRewardShare <= 100 &&
            economics.minimumTaskValue > 0 &&
            economics.penaltyRates.slaBreachPenalty >= 0 &&
            economics.penaltyRates.taskFailurePenalty >= 0
        );
    }

    private validateOperationalLimits(limits: NetworkParameters['operationalLimits']): boolean {
        return (
            limits.maxTaskDuration > limits.minTaskDuration &&
            limits.maxNodesPerTask > limits.minNodesPerTask &&
            limits.maxConcurrentTasks > 0 &&
            limits.maxRetries >= 0
        );
    }

    private validateCrossRegionLimits(limits: NetworkParameters['crossRegionLimits']): boolean {
        return (
            limits.maxRegionsPerTask > limits.minRegionsPerTask &&
            limits.maxNodesPerRegion > limits.minNodesPerRegion &&
            limits.maxCrossRegionLatency > 0 &&
            limits.minRegionReliability >= 0 &&
            limits.minRegionReliability <= 1
        );
    }

    public getParameters(): NetworkParameters {
        return { ...this.parameters };
    }

    public isValidatorStakeEnough(stake: number, isGlobalNode: boolean): boolean {
        const requiredStake = isGlobalNode 
            ? this.parameters.validatorRequirements.globalNodeStake
            : this.parameters.validatorRequirements.regionalNodeStake;
        return stake >= requiredStake;
    }

    public getTaskFee(taskValue: number): number {
        if (taskValue < this.parameters.networkEconomics.minimumTaskValue) {
            throw new Error('Task value below minimum threshold');
        }
        return taskValue * (this.parameters.networkEconomics.taskFeePercentage / 100);
    }

    public isTaskDurationValid(duration: number): boolean {
        return duration >= this.parameters.operationalLimits.minTaskDuration &&
               duration <= this.parameters.operationalLimits.maxTaskDuration;
    }

    public isCrossRegionConfigValid(regionCount: number, nodesPerRegion: number): boolean {
        return regionCount >= this.parameters.crossRegionLimits.minRegionsPerTask &&
               regionCount <= this.parameters.crossRegionLimits.maxRegionsPerTask &&
               nodesPerRegion >= this.parameters.crossRegionLimits.minNodesPerRegion &&
               nodesPerRegion <= this.parameters.crossRegionLimits.maxNodesPerRegion;
    }

    public getValidatorRewardShare(): number {
        return this.parameters.networkEconomics.validatorRewardShare;
    }

    public getLastUpdateTime(): Date {
        return this.lastUpdate;
    }

    public isParameterUpdateHealthy(): boolean {
        const timeSinceLastUpdate = Date.now() - this.lastUpdate.getTime();
        return timeSinceLastUpdate <= config.parameters.refreshInterval * 2;
    }

    public getHealthStatus(): {
        healthy: boolean;
        lastUpdate: Date;
        updateInterval: number;
        retryCount: number;
    } {
        return {
            healthy: this.isParameterUpdateHealthy(),
            lastUpdate: this.lastUpdate,
            updateInterval: config.parameters.updateInterval,
            retryCount: this.retryCount
        };
    }
}

export default NetworkParameterManager.getInstance();