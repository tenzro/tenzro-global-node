// tenzro-global-node/src/network/DHTNetwork.ts

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
    DHTConfig,
    DHTNode,
    DHTAnnouncement,
    PeerFilter,
    NetworkMessage,
    PeerInfo
} from '../types/index';
import { Logger } from '../utils/Logger';
import config from '../config';

interface ExtendedDHTNode extends DHTNode {
    ws?: WebSocket;
}

interface DHTMessageResponse {
    type: string;
    messageId?: string;
    value?: any;
    node?: DHTNode;
    success?: boolean;
    timestamp: string;
}

export class DHTNetwork extends EventEmitter {
    private nodes: Map<string, ExtendedDHTNode> = new Map();
    private data: Map<string, any> = new Map();
    private logger: Logger;
    private nodeId: string;
    private bootstrapNodes: string[];
    private connected: boolean = false;
    private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
    private messageQueue: Map<string, any[]> = new Map();
    private readonly RECONNECT_INTERVAL = 5000;
    private readonly MAX_RECONNECT_ATTEMPTS = 5;
    private readonly CONNECTION_TIMEOUT = 10000;
    private readonly PING_INTERVAL = parseInt(process.env.WEBSOCKET_PING_INTERVAL || '25000', 10);

    constructor(config: DHTConfig) {
        super();
        this.logger = Logger.getInstance();
        this.logger.setContext('DHTNetwork');
        this.nodeId = config.nodeId;
        this.bootstrapNodes = config.bootstrapNodes;
        
        this.setupPeriodicTasks();
        this.setupWebSocketConfig();
    }

    private setupWebSocketConfig(): void {
        setInterval(() => {
            this.nodes.forEach((node) => {
                if (node.ws?.readyState === WebSocket.OPEN) {
                    try {
                        node.ws.ping();
                    } catch (error) {
                        this.logger.warn(`Failed to ping ${node.id}`, error as Error);
                    }
                }
            });
        }, this.PING_INTERVAL);
    }

    private setupPeriodicTasks(): void {
        setInterval(() => this.performHealthChecks(), config.network.healthCheckInterval);
        setInterval(() => this.cleanupInactivePeers(), config.network.cleanupInterval);
    }

    public async join(): Promise<void> {
        try {
            const connectionPromises = this.bootstrapNodes.map(bootstrapNode => 
                this.connectToNodeWithRetry(bootstrapNode, this.MAX_RECONNECT_ATTEMPTS)
            );

            const results = await Promise.allSettled(connectionPromises);
            const connectedCount = results.filter(r => r.status === 'fulfilled').length;

            if (connectedCount === 0) {
                throw new Error('Failed to connect to any bootstrap nodes');
            }

            this.connected = true;
            this.logger.info(`Node ${this.nodeId} joined network with ${connectedCount} connections`);

            // Start periodic refresh of connections
            setInterval(() => this.refreshConnections(), 60000);

        } catch (error) {
            this.logger.error('Failed to join network', error as Error);
            throw error;
        }
    }

    public async leave(): Promise<void> {
        try {
            // Clear reconnection timers
            this.reconnectTimers.forEach(timer => clearTimeout(timer));
            this.reconnectTimers.clear();

            // Close all connections
            for (const [_, node] of this.nodes) {
                if (node.ws) {
                    try {
                        node.ws.close();
                    } catch (error) {
                        this.logger.warn(`Error closing connection to ${node.id}`, error as Error);
                    }
                }
            }

            this.connected = false;
            this.nodes.clear();
            this.data.clear();
            this.messageQueue.clear();

        } catch (error) {
            this.logger.error('Error leaving network', error as Error);
            throw error;
        }
    }

    public async announce(announcement: DHTAnnouncement): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to network');
        }

        try {
            const key = `announcement:${this.nodeId}`;
            await this.store(key, {
                ...announcement,
                timestamp: new Date().toISOString()
            });

            const announceMessage = {
                type: 'announce',
                nodeId: this.nodeId,
                announcement,
                timestamp: new Date().toISOString()
            };

            const announcePromises = Array.from(this.nodes.values()).map(node =>
                this.sendMessageToNode(node, announceMessage).catch(() => {})
            );

            await Promise.allSettled(announcePromises);
        } catch (error) {
            this.logger.error('Failed to announce in network', error as Error);
            throw error;
        }
    }

    public async sendMessage(peerId: string, message: NetworkMessage): Promise<void> {
        const node = this.nodes.get(peerId);
        if (!node || !node.ws) {
            throw new Error(`No connection to peer ${peerId}`);
        }

        await this.sendMessageToNode(node, message);
    }

    public async findValue(key: string): Promise<any> {
        if (!this.connected) {
            throw new Error('Not connected to network');
        }

        return this.data.get(key) || null;
    }

    public async store(key: string, value: any): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to network');
        }

        this.data.set(key, value);

        const replicationMessage = {
            type: 'store',
            key,
            value,
            timestamp: new Date().toISOString()
        };

        const replicationPromises = Array.from(this.nodes.values())
            .slice(0, config.network.dht.replicationFactor)
            .map(node => this.sendMessageToNode(node, replicationMessage).catch(() => {}));

        await Promise.allSettled(replicationPromises);
    }

    public async getPeers(filter?: PeerFilter): Promise<DHTNode[]> {
        if (!this.connected) {
            throw new Error('Not connected to network');
        }

        return Array.from(this.nodes.values())
            .filter(node => this.matchesFilter(node, filter))
            .map(node => {
                const { ws, ...nodeWithoutWs } = node;
                return nodeWithoutWs;
            });
    }

    private async connectToNodeWithRetry(
        address: string, 
        maxAttempts: number
    ): Promise<void> {
        let attempts = 0;
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        while (attempts < maxAttempts) {
            try {
                const ws = new WebSocket(address, {
                    headers: {
                        'X-Node-ID': this.nodeId,
                        'X-Node-Type': 'global_validator'
                    },
                    handshakeTimeout: 10000,
                    perMessageDeflate: false
                });

                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        ws.close();
                        reject(new Error('Connection timeout'));
                    }, 10000);

                    ws.on('open', () => {
                        clearTimeout(timeout);
                        resolve();
                    });

                    ws.on('error', (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                });

                const node: ExtendedDHTNode = {
                    id: `node_${Math.random().toString(36).substr(2, 9)}`,
                    address,
                    lastSeen: new Date(),
                    metadata: {},
                    ws
                };

                this.setupWebSocketHandlers(node);
                this.nodes.set(node.id, node);

                return;
            } catch (error) {
                attempts++;
                this.logger.warn(
                    `Connection attempt ${attempts}/${maxAttempts} to ${address} failed`,
                    error as Error
                );
                if (attempts < maxAttempts) {
                    await delay(this.RECONNECT_INTERVAL * Math.pow(2, attempts - 1));
                }
            }
        }
        throw new Error(`Failed to connect to ${address} after ${maxAttempts} attempts`);
    }

    private setupWebSocketHandlers(node: ExtendedDHTNode): void {
        if (!node.ws) return;

        node.ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                await this.handleMessage(node, message);
            } catch (error) {
                this.logger.error(`Error handling message from ${node.id}`, error as Error);
            }
        });

        node.ws.on('close', () => {
            this.handleNodeDisconnection(node);
        });

        node.ws.on('error', (error) => {
            this.logger.error(`WebSocket error with ${node.id}`, error as Error);
            this.handleNodeDisconnection(node);
        });

        node.ws.on('pong', () => {
            node.lastSeen = new Date();
        });
    }

    private async handleMessage(node: ExtendedDHTNode, message: any): Promise<void> {
        node.lastSeen = new Date();

        try {
            switch (message.type) {
                case 'findNode':
                    await this.handleFindNode(node, message);
                    break;
                case 'store':
                    await this.handleStore(node, message);
                    break;
                case 'announce':
                    await this.handleAnnouncement(node, message);
                    break;
                case 'findValue':
                    await this.handleFindValue(node, message);
                    break;
                default:
                    this.emit('message', message);
            }
        } catch (error) {
            this.logger.error(`Error handling message type ${message.type}`, error as Error);
        }
    }

    private async handleNodeDisconnection(node: ExtendedDHTNode): Promise<void> {
        this.nodes.delete(node.id);
        
        if (this.bootstrapNodes.includes(node.address)) {
            const timer = setTimeout(() => {
                this.connectToNodeWithRetry(node.address, this.MAX_RECONNECT_ATTEMPTS)
                    .catch(error => {
                        this.logger.error(`Failed to reconnect to ${node.address}`, error as Error);
                    });
            }, this.RECONNECT_INTERVAL);
            
            this.reconnectTimers.set(node.address, timer);
        }
    }

    private async refreshConnections(): Promise<void> {
        try {
            const disconnectedNodes = this.bootstrapNodes.filter(node => 
                !Array.from(this.nodes.values()).some(n => n.address === node)
            );

            for (const node of disconnectedNodes) {
                try {
                    await this.connectToNodeWithRetry(node, 1);
                } catch (error) {
                    this.logger.warn(`Failed to reconnect to ${node}`, error as Error);
                }
            }
        } catch (error) {
            this.logger.error('Error refreshing connections', error as Error);
        }
    }

    private async sendMessageToNode(node: ExtendedDHTNode, message: any): Promise<void> {
        if (!node.ws || node.ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Cannot send message, WebSocket not open for node ${node.id}`);
        }

        return new Promise((resolve, reject) => {
            node.ws?.send(JSON.stringify(message), (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    private async handleFindNode(node: ExtendedDHTNode, message: any): Promise<void> {
        if (!message.nodeId) return;

        const foundNode = this.nodes.get(message.nodeId);
        if (foundNode && node.ws) {
            const { ws, ...nodeData } = foundNode;
            await this.sendMessageToNode(node, {
                type: 'findNodeResponse',
                messageId: message.messageId,
                node: nodeData,
                timestamp: new Date().toISOString()
            });
        }
    }

    private async handleStore(node: ExtendedDHTNode, message: any): Promise<void> {
        if (!message.key || message.value === undefined) return;

        this.data.set(message.key, message.value);
        
        if (node.ws) {
            await this.sendMessageToNode(node, {
                type: 'storeResponse',
                messageId: message.messageId,
                success: true,
                timestamp: new Date().toISOString()
            });
        }

        // Replicate to other nodes
        const replicationMessage = {
            type: 'store',
            key: message.key,
            value: message.value,
            timestamp: new Date().toISOString()
        };

        const otherNodes = Array.from(this.nodes.values())
            .filter(n => n.id !== node.id)
            .slice(0, config.network.dht.replicationFactor - 1);

        await Promise.all(
            otherNodes.map(n => 
                this.sendMessageToNode(n, replicationMessage).catch(() => {})
            )
        );
    }

    private async handleAnnouncement(node: ExtendedDHTNode, message: any): Promise<void> {
        if (!message.announcement) return;

        const key = `announcement:${node.id}`;
        await this.store(key, {
            ...message.announcement,
            timestamp: new Date().toISOString()
        });

        this.emit('announcement', message.announcement);
    }

    private async handleFindValue(node: ExtendedDHTNode, message: any): Promise<void> {
        if (!message.key) return;

        const value = this.data.get(message.key);
        
        if (node.ws) {
            await this.sendMessageToNode(node, {
                type: 'findValueResponse',
                messageId: message.messageId,
                value,
                timestamp: new Date().toISOString()
            });
        }
    }

    public async subscribe(key: string, callback: (value: any) => void): Promise<void> {
        this.on(`value:${key}`, callback);
    }

    public unsubscribe(key: string, callback: (value: any) => void): void {
        this.removeListener(`value:${key}`, callback);
    }

    private async broadcastMessage(message: any): Promise<void> {
        const promises = Array.from(this.nodes.values())
            .map(node => this.sendMessageToNode(node, message).catch(() => {}));

        await Promise.allSettled(promises);
    }

    private performHealthChecks(): void {
        this.nodes.forEach((node) => {
            if (node.ws?.readyState === WebSocket.OPEN) {
                try {
                    node.ws.ping();
                } catch (error) {
                    this.logger.warn(`Failed to ping ${node.id}`, error as Error);
                }
            }
        });
    }

    private cleanupInactivePeers(): void {
        const now = Date.now();
        const timeout = config.network.peerTimeout;

        this.nodes.forEach((node, nodeId) => {
            if (now - node.lastSeen.getTime() > timeout) {
                this.logger.info(`Removing inactive node ${nodeId}`);
                if (node.ws) {
                    node.ws.close();
                }
                this.nodes.delete(nodeId);
            }
        });
    }

    private matchesFilter(node: ExtendedDHTNode, filter?: PeerFilter): boolean {
        if (!filter) return true;

        const metadata = node.metadata || {};
        
        if (filter.nodeType && metadata.nodeType !== filter.nodeType) return false;
        if (filter.region && metadata.region !== filter.region) return false;
        if (filter.minTokens && (metadata.tokenBalance || 0) < filter.minTokens) return false;
        if (filter.nodeTier && metadata.nodeTier !== filter.nodeTier) return false;

        return true;
    }

    public async ping(nodeId: string): Promise<boolean> {
        const node = this.nodes.get(nodeId);
        if (!node || !node.ws) return false;

        try {
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Ping timeout')), 5000);
                node.ws?.ping(() => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
            return true;
        } catch {
            return false;
        }
    }

    public getNodeInfo(nodeId: string): DHTNode | null {
        const node = this.nodes.get(nodeId);
        if (!node) return null;

        const { ws, ...nodeInfo } = node;
        return nodeInfo;
    }

    public getConnectedPeers(): string[] {
        return Array.from(this.nodes.keys());
    }

    public getNodeCount(): number {
        return this.nodes.size;
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public getStoredKeys(): string[] {
        return Array.from(this.data.keys());
    }

    public async clearData(): Promise<void> {
        this.data.clear();
    }

    public getDiagnostics(): {
        nodeCount: number;
        connected: boolean;
        storedKeys: number;
        bootstrapNodes: string[];
        activeConnections: number;
    } {
        return {
            nodeCount: this.nodes.size,
            connected: this.connected,
            storedKeys: this.data.size,
            bootstrapNodes: this.bootstrapNodes,
            activeConnections: Array.from(this.nodes.values())
                .filter(n => n.ws?.readyState === WebSocket.OPEN).length
        };
    }

    public async checkBootstrapNodes(): Promise<Map<string, boolean>> {
        const results = new Map<string, boolean>();
        
        for (const node of this.bootstrapNodes) {
            try {
                await this.connectToNodeWithRetry(node, 1);
                results.set(node, true);
            } catch {
                results.set(node, false);
            }
        }

        return results;
    }

    private async reconnectToBootstrapNodes(): Promise<void> {
        const connectionPromises = this.bootstrapNodes.map(bootstrapNode => 
            this.connectToNodeWithRetry(bootstrapNode, this.MAX_RECONNECT_ATTEMPTS)
        );
    
        await Promise.allSettled(connectionPromises);
    }
}

export default DHTNetwork;