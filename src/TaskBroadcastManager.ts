// tenzro-global-node/src/TaskBroadcastManager.ts

import { EventEmitter } from 'events';
import { DHTNetwork } from './network/DHTNetwork';
import { Logger } from './utils/Logger';
import { 
    TaskBroadcast, 
    RegionalResponse, 
    TaskDistribution, 
    NetworkMessage,
    TaskRequirements,
    NodeTier,
    TaskAcceptanceMessage,
    TaskRejectionMessage,
    TaskProgressMessage,
    TaskCompletionMessage
} from './types/index';
import config from './config';

export class TaskBroadcastManager extends EventEmitter {
    private activeBroadcasts: Map<string, TaskBroadcast>;
    private regionalResponses: Map<string, RegionalResponse[]>;
    private logger: Logger;
    private pendingTasks: Set<string>;

    constructor(
        private dht: DHTNetwork,
        private nodeId: string
    ) {
        super();
        this.activeBroadcasts = new Map();
        this.regionalResponses = new Map();
        this.pendingTasks = new Set();
        this.logger = Logger.getInstance();
        this.logger.setContext('TaskBroadcastManager');
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.dht.on('message', this.handleDHTMessage.bind(this));
    }

    public async broadcastTask(task: TaskBroadcast): Promise<void> {
        try {
            // Validate task
            this.validateTaskBroadcast(task);
            
            if (this.pendingTasks.has(task.taskId)) {
                throw new Error('Task already being processed');
            }
            
            // Store in active broadcasts and mark as pending
            this.activeBroadcasts.set(task.taskId, task);
            this.pendingTasks.add(task.taskId);

            // Prepare broadcast message
            const message: NetworkMessage = {
                type: 'task_broadcast',
                sender: this.nodeId,
                data: task,
                timestamp: new Date().toISOString()
            };

            // Get regional validators that match task requirements
            const regionalValidators = await this.dht.getPeers({
                nodeType: 'regional_node',
                nodeTier: task.requirements.nodeTier
            });

            if (regionalValidators.length === 0) {
                throw new Error('No eligible regional validators found');
            }

            // Broadcast to eligible regional validators
            await Promise.all(regionalValidators.map(validator =>
                this.dht.sendMessage(validator.id, message)
            ));

            this.logger.info(`Task ${task.taskId} broadcasted to ${regionalValidators.length} regional validators`);

            // Set timeout for regional responses
            setTimeout(() => this.processRegionalResponses(task.taskId), config.tasks.taskTimeout);

        } catch (error) {
            this.pendingTasks.delete(task.taskId);
            this.logger.error(`Failed to broadcast task ${task.taskId}`, error as Error);
            throw error;
        }
    }

    private validateTaskBroadcast(task: TaskBroadcast): void {
        if (!task.taskId || !task.requirements || !task.source) {
            throw new Error('Invalid task broadcast format');
        }

        if (!this.validateNodeTier(task.requirements)) {
            throw new Error('Invalid node tier requirement');
        }

        if (!this.validateBudget(task)) {
            throw new Error('Invalid task budget');
        }

        // Validate task constraints
        if (task.requirements.constraints) {
            this.validateConstraints(task.requirements.constraints);
        }
    }

    private validateNodeTier(requirements: TaskRequirements): boolean {
        const validTiers: NodeTier[] = ['inference', 'aggregator', 'training', 'feedback'];
        return validTiers.includes(requirements.nodeTier);
    }

    private validateBudget(task: TaskBroadcast): boolean {
        return (
            task.budget &&
            task.budget.maxAmount > 0 &&
            typeof task.budget.tokenType === 'string' &&
            ['prepaid', 'postpaid'].includes(task.budget.paymentMethod)
        );
    }

    private validateConstraints(constraints: any): void {
        if (constraints.maxLatency && typeof constraints.maxLatency !== 'number') {
            throw new Error('Invalid maxLatency constraint');
        }
        if (constraints.redundancy && typeof constraints.redundancy !== 'number') {
            throw new Error('Invalid redundancy constraint');
        }
    }

    private async handleDHTMessage(message: NetworkMessage): Promise<void> {
        try {
            switch (message.type) {
                case 'regional_response':
                    await this.handleRegionalResponse(message.data as RegionalResponse);
                    break;
                case 'task_accepted':
                    await this.handleTaskAcceptance(message.data as TaskAcceptanceMessage);
                    break;
                case 'task_rejected':
                    await this.handleTaskRejection(message.data as TaskRejectionMessage);
                    break;
                case 'task_progress':
                    await this.handleTaskProgress(message.data as TaskProgressMessage);
                    break;
                case 'task_completed':
                    await this.handleTaskCompletion(message.data as TaskCompletionMessage);
                    break;
                default:
                    this.logger.warn(`Unhandled message type: ${message.type}`);
            }
        } catch (error) {
            this.logger.error(`Error handling message type ${message.type}`, error as Error);
        }
    }    

    private async handleRegionalResponse(response: RegionalResponse): Promise<void> {
        if (!this.pendingTasks.has(response.taskId)) {
            return; // Ignore responses for unknown tasks
        }

        const responses = this.regionalResponses.get(response.taskId) || [];
        responses.push(response);
        this.regionalResponses.set(response.taskId, responses);
    }

    private async processRegionalResponses(taskId: string): Promise<void> {
        if (!this.pendingTasks.has(taskId)) {
            return;
        }

        const task = this.activeBroadcasts.get(taskId);
        if (!task) return;

        try {
            const responses = this.regionalResponses.get(taskId) || [];
            
            // Filter acceptable responses
            const acceptedResponses = responses.filter(r => 
                r.acceptance && 
                r.capacity.availableNodes >= task.requirements.minNodes
            );

            if (acceptedResponses.length === 0) {
                await this.handleNoAcceptedResponses(taskId);
                return;
            }

            // Calculate task distribution
            const distribution = this.calculateTaskDistribution(task, acceptedResponses);
            
            // Assign task to regions
            await this.assignTaskToRegions(distribution);

            this.emit('task_distributed', taskId);

        } catch (error) {
            this.logger.error(`Failed to process responses for task ${taskId}`, error as Error);
            await this.handleTaskFailure(taskId, error as Error);
        } finally {
            this.pendingTasks.delete(taskId);
        }
    }

    private calculateTaskDistribution(task: TaskBroadcast, responses: RegionalResponse[]): TaskDistribution {
        const distribution = new Map();
        let remainingNodes = task.requirements.maxNodes;

        // Sort responses by priority score (higher is better)
        responses.sort((a, b) => b.priority - a.priority);

        for (const response of responses) {
            if (remainingNodes <= 0) break;

            const nodeCount = Math.min(
                response.capacity.availableNodes,
                remainingNodes
            );

            if (nodeCount > 0) {
                distribution.set(response.regionId, {
                    nodeCount,
                    priorityScore: response.priority
                });
                remainingNodes -= nodeCount;
            }
        }

        return {
            taskId: task.taskId,
            regions: distribution,
            timestamp: new Date().toISOString(),
            distribution: Array.from(distribution.entries()),
            totalNodes: task.requirements.maxNodes,
            strategy: 'default',
            version: 1.0
        };
    }

    private async assignTaskToRegions(distribution: TaskDistribution): Promise<void> {
        const assignments = Array.from(distribution.regions.entries());

        await Promise.all(assignments.map(async ([regionId, details]) => {
            const message: NetworkMessage = {
                type: 'task_assignment',
                sender: this.nodeId,
                data: {
                    taskId: distribution.taskId,
                    nodeCount: details.nodeCount,
                    priority: details.priorityScore
                },
                timestamp: new Date().toISOString()
            };

            try {
                const regionalValidator = await this.dht.getPeers({
                    nodeType: 'regional_node',
                    region: regionId
                });

                if (regionalValidator[0]) {
                    await this.dht.sendMessage(regionalValidator[0].id, message);
                    this.logger.info(`Task assigned to region ${regionId}`);
                }
            } catch (error) {
                this.logger.error(`Failed to assign task to region ${regionId}`, error as Error);
                throw error;
            }
        }));
    }

    private async handleNoAcceptedResponses(taskId: string): Promise<void> {
        const task = this.activeBroadcasts.get(taskId);
        if (!task) return;

        await this.notifyTaskSource(taskId, {
            type: 'task_failed',
            reason: 'No regional validators accepted the task',
            timestamp: new Date().toISOString()
        });

        this.activeBroadcasts.delete(taskId);
        this.regionalResponses.delete(taskId);
    }

    private async handleTaskFailure(taskId: string, error: Error): Promise<void> {
        await this.notifyTaskSource(taskId, {
            type: 'task_failed',
            reason: error.message,
            timestamp: new Date().toISOString()
        });

        this.activeBroadcasts.delete(taskId);
        this.regionalResponses.delete(taskId);
    }

    private async notifyTaskSource(taskId: string, message: any): Promise<void> {
        const task = this.activeBroadcasts.get(taskId);
        if (!task) return;

        try {
            await this.dht.sendMessage(task.source.nodeId, {
                type: message.type,
                sender: this.nodeId,
                data: message,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.logger.error(`Failed to notify task source for ${taskId}`, error as Error);
        }
    }

    private async handleTaskCompletion(data: any): Promise<void> {
        const task = this.activeBroadcasts.get(data.taskId);
        if (!task) return;

        await this.notifyTaskSource(data.taskId, {
            type: 'task_completed',
            result: data.result,
            timestamp: new Date().toISOString()
        });

        this.activeBroadcasts.delete(data.taskId);
        this.regionalResponses.delete(data.taskId);
        this.emit('task_completed', data.taskId, data.result);
    }

    public async stop(): Promise<void> {
        // Clean up active tasks
        for (const [taskId, task] of this.activeBroadcasts.entries()) {
            await this.notifyTaskSource(taskId, {
                type: 'task_failed',
                reason: 'Task broadcast manager shutting down',
                timestamp: new Date().toISOString()
            });
        }

        this.activeBroadcasts.clear();
        this.regionalResponses.clear();
        this.pendingTasks.clear();
        this.removeAllListeners();
    }

    private async handleTaskAcceptance(data: TaskAcceptanceMessage): Promise<void> {
        const task = this.activeBroadcasts.get(data.taskId);
        if (!task) return;
    
        this.logger.info(`Task ${data.taskId} accepted by region ${data.regionId}`);
        
        // Update task status in DHT
        await this.dht.store(`task:${data.taskId}:status`, {
            status: 'accepted',
            regionId: data.regionId,
            validatorId: data.validatorId,
            timestamp: new Date().toISOString()
        });
    
        await this.notifyTaskSource(data.taskId, {
            type: 'task_status',
            status: 'accepted',
            region: data.regionId,
            timestamp: new Date().toISOString()
        });
    }
    
    private async handleTaskRejection(data: TaskRejectionMessage): Promise<void> {
        const task = this.activeBroadcasts.get(data.taskId);
        if (!task) return;
    
        this.logger.warn(`Task ${data.taskId} rejected by region ${data.regionId}: ${data.reason}`);
    
        // If this was the only possible region, handle failure
        const responses = this.regionalResponses.get(data.taskId) || [];
        const remainingRegions = responses.filter(r => 
            r.regionId !== data.regionId && r.acceptance
        );
    
        if (remainingRegions.length === 0) {
            await this.handleTaskFailure(data.taskId, new Error('No remaining regions available'));
        }
    }
    
    private async handleTaskProgress(data: TaskProgressMessage): Promise<void> {
        const task = this.activeBroadcasts.get(data.taskId);
        if (!task) return;
    
        this.logger.debug(`Task ${data.taskId} progress update: ${data.progress}%`);
    
        // Store progress in DHT
        await this.dht.store(`task:${data.taskId}:progress`, {
            progress: data.progress,
            timestamp: new Date().toISOString()
        });
    
        // Notify task source of progress
        await this.notifyTaskSource(data.taskId, {
            type: 'task_progress',
            progress: data.progress,
            region: data.regionId,
            timestamp: new Date().toISOString()
        });
    }    
}

export default TaskBroadcastManager;