// tenzro-global-node/src/server.ts

import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as WebSocketServer, WebSocket } from 'ws';
import { DHTNetwork } from './network/DHTNetwork';
import { GlobalNodeManager } from './GlobalNodeManager';
import { Logger } from './utils/Logger';
import { TaskBroadcast, NetworkState, NetworkMessage } from './types/index';
import config from './config';

export class Server {
    private app: express.Application;
    private server: http.Server;
    private wss: WebSocketServer;
    private globalNode: GlobalNodeManager;
    private dht: DHTNetwork;
    private logger: Logger;
    private isShuttingDown: boolean = false;

    constructor(
        private nodeId: string,
        private region: string,
        private tokenBalance: number,
        private port: number = parseInt(process.env.PORT || '8080', 10)
    ) {
        this.logger = Logger.getInstance();
        this.logger.setContext('Server');
        
        // Initialize Express
        this.app = express();
        this.setupMiddleware();
        
        // Create HTTP server
        this.server = http.createServer(this.app);
        
        // Initialize WebSocket server
        this.wss = new WebSocketServer({ server: this.server });
        
        // Initialize DHT network
        this.dht = new DHTNetwork({
            nodeId: this.nodeId,
            bootstrapNodes: process.env.BOOTSTRAP_NODES?.split(',') || []
        });

        // Initialize global node manager
        this.globalNode = new GlobalNodeManager(
            this.dht,
            this.nodeId,
            this.region,
            this.tokenBalance
        );

        this.setupRoutes();
        this.setupWebSocketHandlers();
        this.setupErrorHandling();
    }

    private setupMiddleware(): void {
        const isProduction = process.env.NODE_ENV === 'production';

        // Enable CORS with specific options
        this.app.use(cors({
            origin: process.env.CORS_ORIGIN || '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }));

        // SSL redirection in production
        if (isProduction) {
            this.app.enable('trust proxy');
            this.app.use((req, res, next) => {
                if (req.header('x-forwarded-proto') !== 'https') {
                    res.redirect(`https://${req.header('host')}${req.url}`);
                } else {
                    next();
                }
            });
        }

        // Body parsing middleware
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Request logging middleware
        this.app.use((req, res, next) => {
            this.logger.info(`${req.method} ${req.path}`, {
                ip: req.ip,
                userAgent: req.get('user-agent')
            });
            next();
        });

        // Basic security headers
        this.app.use((req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-XSS-Protection', '1; mode=block');
            next();
        });
    }

    private setupWebSocketHandlers(): void {
        this.wss.on('connection', (ws: WebSocket & { isAlive?: boolean }) => {
            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message.toString());
                    await this.handleWebSocketMessage(ws, data);
                } catch (error) {
                    this.logger.error('Failed to process WebSocket message', error as Error);
                }
            });

            ws.on('close', () => {
                this.handleWebSocketDisconnection(ws);
            });

            // Setup ping/pong
            ws.isAlive = true;
            ws.on('pong', () => {
                ws.isAlive = true;
            });
        });

        // Periodic status broadcast and connection cleanup
        const statusInterval = setInterval(() => {
            this.broadcastStatus();
        }, 30000);

        const pingInterval = setInterval(() => {
            this.wss.clients.forEach((ws: any) => {
                if (ws.isAlive === false) {
                    ws.terminate();
                    return;
                }
                ws.isAlive = false;
                ws.ping();
            });
        }, parseInt(process.env.WEBSOCKET_PING_INTERVAL || '25000', 10));

        this.wss.on('close', () => {
            clearInterval(statusInterval);
            clearInterval(pingInterval);
        });
    }

    private async handleWebSocketMessage(ws: WebSocket, message: any): Promise<void> {
        if (message.type === 'task_broadcast') {
            await this.globalNode.emit('message', {
                type: 'task_broadcast',
                sender: message.sender || 'websocket',
                data: message.data,
                timestamp: new Date().toISOString()
            });
        }
    }

    private handleWebSocketDisconnection(ws: WebSocket): void {
        // Cleanup any resources associated with this connection
    }

    private broadcastStatus(): void {
        const status = {
            nodeId: this.nodeId,
            region: this.region,
            active: this.globalNode.isActive(),
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };

        this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'status',
                    data: status,
                    timestamp: new Date().toISOString()
                }));
            }
        });
    }

    private setupRoutes(): void {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            const healthStatus = {
                status: this.globalNode.isActive() ? 'healthy' : 'unhealthy',
                nodeId: this.nodeId,
                region: this.region,
                active: this.globalNode.isActive(),
                timestamp: new Date().toISOString(),
                version: process.env.npm_package_version || '1.0.0',
                uptime: process.uptime()
            };

            if (healthStatus.status === 'healthy') {
                res.json(healthStatus);
            } else {
                res.status(503).json(healthStatus);
            }
        });

        // Network state endpoint
        this.app.get('/api/network/state', async (req, res) => {
            try {
                if (!this.globalNode.isActive()) {
                    return res.status(503).json({ error: 'Node is not active' });
                }

                const state = await this.globalNode.getNetworkState();
                res.json(state);
            } catch (error) {
                this.logger.error('Failed to get network state', error as Error);
                res.status(500).json({ 
                    error: 'Failed to get network state',
                    message: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
                });
            }
        });

        // Submit task endpoint
        this.app.post('/api/tasks', async (req, res) => {
            try {
                if (!this.globalNode.isActive()) {
                    return res.status(503).json({ error: 'Node is not accepting tasks' });
                }

                const task: TaskBroadcast = req.body;
                
                // Validate task format
                const validationError = this.validateTaskSubmission(task);
                if (validationError) {
                    return res.status(400).json({ error: validationError });
                }

                // Forward to global node
                await this.globalNode.emit('message', {
                    type: 'task_broadcast',
                    sender: 'api',
                    data: task,
                    timestamp: new Date().toISOString()
                });

                res.status(202).json({
                    message: 'Task submitted successfully',
                    taskId: task.taskId,
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                this.logger.error('Failed to submit task', error as Error);
                res.status(500).json({ 
                    error: 'Failed to submit task',
                    message: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
                });
            }
        });

        // Get task status endpoint
        this.app.get('/api/tasks/:taskId', async (req, res) => {
            try {
                if (!this.globalNode.isActive()) {
                    return res.status(503).json({ error: 'Node is not active' });
                }

                const taskState = await this.dht.findValue(`task:${req.params.taskId}:state`);
                if (!taskState) {
                    return res.status(404).json({ error: 'Task not found' });
                }
                res.json(taskState);
            } catch (error) {
                this.logger.error('Failed to get task status', error as Error);
                res.status(500).json({ 
                    error: 'Failed to get task status',
                    message: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
                });
            }
        });

        // Node status endpoint
        this.app.get('/status', (req, res) => {
            const status = {
                nodeId: this.nodeId,
                region: this.region,
                active: this.globalNode.isActive(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                version: process.env.npm_package_version || '1.0.0',
                env: process.env.NODE_ENV,
                timestamp: new Date().toISOString()
            };
            res.json(status);
        });
    }

    private setupErrorHandling(): void {
        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({ 
                error: 'Not found',
                path: req.path,
                timestamp: new Date().toISOString()
            });
        });

        // Global error handler
        this.app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
            this.logger.error('Unhandled error', err);
            res.status(500).json({
                error: 'Internal server error',
                message: process.env.NODE_ENV === 'development' ? err.message : undefined,
                timestamp: new Date().toISOString()
            });
        });
    }

    private validateTaskSubmission(task: TaskBroadcast): string | null {
        if (!task) return 'Task is required';
        if (!task.taskId) return 'Task ID is required';
        if (!task.type) return 'Task type is required';
        if (!task.requirements) return 'Task requirements are required';
        if (!task.requirements.nodeTier) return 'Node tier is required';
        if (!task.requirements.minNodes) return 'Minimum nodes is required';
        if (!task.requirements.maxNodes) return 'Maximum nodes is required';
        if (!task.budget) return 'Task budget is required';
        if (!task.budget.maxAmount || task.budget.maxAmount <= 0) return 'Valid budget amount is required';
        if (!task.source) return 'Task source is required';
        if (!task.source.nodeId) return 'Source node ID is required';
        if (!task.source.region) return 'Source region is required';

        return null;
    }

    public async start(): Promise<void> {
        try {
            // First, start the HTTP server
            await this.startHttpServer();

            // Add a small delay to ensure port binding is complete
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Then start the global node if DHT is enabled
            if (process.env.DHT_ENABLED !== 'false') {
                try {
                    await this.globalNode.start();
                } catch (error) {
                    this.logger.error('Failed to start global node', error as Error);
                }
            } else {
                this.logger.info('DHT disabled, skipping global node start');
            }

            // Setup graceful shutdown
            this.setupGracefulShutdown();

            this.logger.info(`Server fully initialized and running on port ${process.env.PORT || this.port}`);
            this.logger.info(`Environment: ${process.env.NODE_ENV}`);
            this.logger.info(`Region: ${this.region}`);
            this.logger.info(`Node Type: ${process.env.NODE_TYPE}`);

        } catch (error) {
            this.logger.error('Failed to start server', error as Error);
            throw error;
        }
    }

    private async startHttpServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            const port = process.env.PORT || this.port;
            
            if (this.server.listening) {
                this.logger.warn('Server already listening');
                resolve();
                return;
            }

            const bindTimeout = setTimeout(() => {
                this.logger.error(`Failed to bind to port ${port} within timeout`);
                reject(new Error('Server bind timeout'));
            }, 30000);

            this.server
                .listen({
                    port: Number(port),
                    host: '0.0.0.0'
                }, () => {
                    clearTimeout(bindTimeout);
                    this.logger.info(`HTTP server listening on port ${port}`);
                    resolve();
                })
                .once('error', (error) => {
                    clearTimeout(bindTimeout);
                    this.logger.error(`Failed to bind to port ${port}`, error);
                    reject(error);
                });
        });
    }

    private setupGracefulShutdown(): void {
        const shutdown = async (signal: string) => {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;

            this.logger.info(`Received ${signal} signal, starting graceful shutdown`);
            
            try {
                // Stop accepting new WebSocket connections
                this.wss.close(() => {
                    this.logger.info('WebSocket server closed');
                });

                // Close existing WebSocket connections
                this.wss.clients.forEach((client) => {
                    client.close();
                });

                // Stop accepting new HTTP requests
                this.server.close(() => {
                    this.logger.info('HTTP server closed');
                });

                // Stop global node if running
                if (process.env.DHT_ENABLED !== 'false') {
                    await this.globalNode.stop();
                    this.logger.info('Global node stopped');
                }

                // Allow time for cleanup
                await new Promise(resolve => setTimeout(resolve, 5000));

                this.logger.info('Server stopped gracefully');
                process.exit(0);

            } catch (error) {
                this.logger.error('Error during shutdown', error as Error);
                process.exit(1);
            } finally {
                // Force exit after timeout
                setTimeout(() => {
                    this.logger.error('Failed to shutdown gracefully, forcing exit');
                    process.exit(1);
                }, 30000);
            }
        };

        // Setup signal handlers
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        // Handle uncaught errors
        process.on('uncaughtException', (error: Error) => {
            this.logger.error('Uncaught exception', error);
            shutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason: any) => {
            this.logger.error('Unhandled rejection', reason);
            shutdown('unhandledRejection');
        });
    }

    public async stop(): Promise<void> {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        try {
            // Close WebSocket server
            await new Promise<void>((resolve) => {
                this.wss.close(() => resolve());
            });

            // Stop global node
            await this.globalNode.stop();

            // Close HTTP server
            await new Promise<void>((resolve, reject) => {
                this.server.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (error) {
            this.logger.error('Error stopping server', error as Error);
            throw error;
        }
    }
}

export default Server;