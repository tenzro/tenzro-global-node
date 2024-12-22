// tenzro-global-node/src/utils/Logger.ts

export class Logger {
    private static instance: Logger;
    private context: string = 'Global';

    private constructor() {}

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    setContext(context: string): void {
        this.context = context;
    }

    info(message: string, meta?: any): void {
        console.log(this.format('INFO', message, meta));
    }

    error(message: string, error?: Error, meta?: any): void {
        console.error(this.format('ERROR', message, { ...meta, error: error?.stack }));
    }

    warn(message: string, meta?: any): void {
        console.warn(this.format('WARN', message, meta));
    }

    debug(message: string, meta?: any): void {
        if (process.env.NODE_ENV === 'development') {
            console.debug(this.format('DEBUG', message, meta));
        }
    }

    private format(level: string, message: string, meta?: any): string {
        const timestamp = new Date().toISOString();
        const baseMessage = `[${timestamp}] [${level}] [${this.context}] ${message}`;
        return meta ? `${baseMessage} ${JSON.stringify(meta, null, 2)}` : baseMessage;
    }
}

export default Logger.getInstance();