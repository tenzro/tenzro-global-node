// tenzro-global-node/src/main.ts

import dotenv from 'dotenv';
import path from 'path';
import { Server } from './server';
import { Logger } from './utils/Logger';
import config from './config';

// Initialize logger
const logger = Logger.getInstance();
logger.setContext('Main');

// Load environment variables
const envPath = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: path.join(process.cwd(), envPath) });

interface GlobalNodeConfig {
    nodeId: string;
    region: string;
    tokenBalance: number;
    port: number;
}

async function validateConfig(): Promise<GlobalNodeConfig> {
    const nodeId = process.env.NODE_ID || `node_${Math.random().toString(36).substr(2, 9)}`;
    const region = process.env.REGION;
    const tokenBalance = parseInt(process.env.TOKEN_BALANCE || '0', 10);
    const port = parseInt(process.env.PORT || '8080', 10);

    // Validate region
    if (!region || region.trim() === '') {
        throw new Error('Region must be specified');
    }

    // Validate token balance
    if (tokenBalance < config.validator.globalTokenRequirement) {
        throw new Error(`Insufficient tokens for global validator. Required: ${config.validator.globalTokenRequirement}, Have: ${tokenBalance}`);
    }

    // Validate port
    if (port < 1024 || port > 65535) {
        throw new Error('Port must be between 1024 and 65535');
    }

    return {
        nodeId,
        region,
        tokenBalance,
        port
    };
}

async function main() {
    try {
        const nodeId = process.env.NODE_ID || `node_${Math.random().toString(36).substr(2, 9)}`;
        const region = process.env.REGION || 'default';
        const tokenBalance = parseInt(process.env.TOKEN_BALANCE || '10000', 10);
        const port = parseInt(process.env.PORT || '8080', 10);

        logger.info('Starting global node with configuration:', {
            nodeId,
            region,
            port,
            tokenBalance,
            environment: process.env.NODE_ENV,
            dhtEnabled: process.env.DHT_ENABLED !== 'false'
        });

        const server = new Server(nodeId, region, tokenBalance, port);
        await server.start();

        logger.info(`Global node running at http://0.0.0.0:${port}`);

    } catch (error) {
        logger.error('Failed to start global node', error as Error);
        process.exit(1);
    }
}

// Execute main function if this is the entry point
if (require.main === module) {
    main().catch(error => {
        logger.error('Fatal error in main process', error);
        process.exit(1);
    });
}

export { main, validateConfig };