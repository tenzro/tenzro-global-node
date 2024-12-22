// tenzro-global-node/src/MetricsCollector.ts

import { RegionInfo, ConnectedPeer, NetworkState } from './types';
import { Logger } from './utils/Logger';
import config from './config';

interface NetworkMetrics {
    timestamp: string;
    totalPeers: number;
    activePeers: number;
    validators: {
        regional: number;
        global: number;
    };
    regions: {
        total: number;
        active: number;
    };
    connections: {
        total: number;
        average: number;
    };
}

interface RegionMetrics {
    timestamp: string;
    peers: number;
    validators: number;
    connections: number;
}

export class MetricsCollector {
    private logger: Logger;
    private networkMetrics: NetworkMetrics[] = [];
    private regionMetrics: Map<string, RegionMetrics[]> = new Map();
    private readonly maxMetricsHistory: number;

    constructor() {
        this.logger = Logger.getInstance();
        this.logger.setContext('MetricsCollector');
        // Calculate max metrics based on 24 hours of data at given interval
        this.maxMetricsHistory = Math.floor((24 * 60 * 60 * 1000) / config.metrics.updateInterval);
    }

    public updateNetworkMetrics(peers: ConnectedPeer[], regions: RegionInfo[]): void {
        const activePeers = peers.filter(p => p.status.online);
        
        const metrics: NetworkMetrics = {
            timestamp: new Date().toISOString(),
            totalPeers: peers.length,
            activePeers: activePeers.length,
            validators: {
                regional: peers.filter(p => p.info.nodeType === 'regional_node').length,
                global: peers.filter(p => p.info.nodeType === 'global_node').length
            },
            regions: {
                total: regions.length,
                active: regions.filter(r => r.status === 'active').length
            },
            connections: {
                total: peers.reduce((sum, p) => sum + p.status.connections, 0),
                average: peers.length ? 
                    peers.reduce((sum, p) => sum + p.status.connections, 0) / peers.length : 0
            }
        };

        this.networkMetrics.push(metrics);
        this.enforceMetricsLimit();
    }

    public updateRegionMetrics(region: string, peers: ConnectedPeer[]): void {
        const metrics: RegionMetrics = {
            timestamp: new Date().toISOString(),
            peers: peers.length,
            validators: peers.filter(p => p.info.nodeType !== 'individual').length,
            connections: peers.reduce((sum, p) => sum + p.status.connections, 0)
        };

        if (!this.regionMetrics.has(region)) {
            this.regionMetrics.set(region, []);
        }

        const regionHistory = this.regionMetrics.get(region)!;
        regionHistory.push(metrics);
        this.enforceRegionMetricsLimit(region);
    }

    private enforceMetricsLimit(): void {
        while (this.networkMetrics.length > this.maxMetricsHistory) {
            this.networkMetrics.shift();
        }
    }

    private enforceRegionMetricsLimit(region: string): void {
        const regionHistory = this.regionMetrics.get(region);
        if (regionHistory && regionHistory.length > this.maxMetricsHistory) {
            regionHistory.shift();
        }
    }

    public getNetworkHealth(): boolean {
        if (this.networkMetrics.length === 0) return true;

        const latest = this.networkMetrics[this.networkMetrics.length - 1];
        const thresholds = config.metrics.healthThresholds;

        const activePeerRatio = latest.activePeers / latest.totalPeers;
        const sufficientValidators = latest.regions.active >= thresholds.minValidators;
        const healthStatus = activePeerRatio >= thresholds.minActivePeers && sufficientValidators;

        this.logger.debug('Network health check', {
            activePeerRatio,
            sufficientValidators,
            healthStatus
        });

        return healthStatus;
    }

    public getNetworkMetrics(duration: number = 3600000): NetworkMetrics[] {
        const since = Date.now() - duration;
        return this.networkMetrics.filter(m => 
            new Date(m.timestamp).getTime() > since
        );
    }

    public getRegionMetrics(region: string, duration: number = 3600000): RegionMetrics[] {
        const regionHistory = this.regionMetrics.get(region) || [];
        const since = Date.now() - duration;
        return regionHistory.filter(m =>
            new Date(m.timestamp).getTime() > since
        );
    }

    public getLatestNetworkMetrics(): NetworkMetrics | undefined {
        return this.networkMetrics[this.networkMetrics.length - 1];
    }

    public getLatestRegionMetrics(region: string): RegionMetrics | undefined {
        const regionHistory = this.regionMetrics.get(region) || [];
        return regionHistory[regionHistory.length - 1];
    }

    public getNetworkSummary(): {
        currentStatus: NetworkMetrics;
        hourlyAverages: NetworkMetrics[];
        dailyAverages: NetworkMetrics[];
    } {
        const currentStatus = this.getLatestNetworkMetrics()!;
        const hourlyAverages = this.calculateHourlyAverages();
        const dailyAverages = this.calculateDailyAverages();

        return {
            currentStatus,
            hourlyAverages,
            dailyAverages
        };
    }

    private calculateHourlyAverages(): NetworkMetrics[] {
        return this.calculateAverages(3600000); // 1 hour in milliseconds
    }

    private calculateDailyAverages(): NetworkMetrics[] {
        return this.calculateAverages(86400000); // 24 hours in milliseconds
    }

    private calculateAverages(interval: number): NetworkMetrics[] {
        const averages: NetworkMetrics[] = [];
        const now = Date.now();
        const timeSlots = new Map<number, NetworkMetrics[]>();

        // Group metrics by time slots
        this.networkMetrics.forEach(metric => {
            const timestamp = new Date(metric.timestamp).getTime();
            const slot = Math.floor(timestamp / interval) * interval;
            
            if (!timeSlots.has(slot)) {
                timeSlots.set(slot, []);
            }
            timeSlots.get(slot)!.push(metric);
        });

        // Calculate averages for each time slot
        timeSlots.forEach((metrics, slot) => {
            if (now - slot <= 24 * 3600000) { // Only include last 24 hours
                const average = this.calculateMetricsAverage(metrics);
                averages.push(average);
            }
        });

        return averages.sort((a, b) => 
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
    }

    private calculateMetricsAverage(metrics: NetworkMetrics[]): NetworkMetrics {
        const count = metrics.length;
        return {
            timestamp: new Date(metrics[0].timestamp).toISOString(),
            totalPeers: Math.round(metrics.reduce((sum, m) => sum + m.totalPeers, 0) / count),
            activePeers: Math.round(metrics.reduce((sum, m) => sum + m.activePeers, 0) / count),
            validators: {
                regional: Math.round(metrics.reduce((sum, m) => sum + m.validators.regional, 0) / count),
                global: Math.round(metrics.reduce((sum, m) => sum + m.validators.global, 0) / count)
            },
            regions: {
                total: Math.round(metrics.reduce((sum, m) => sum + m.regions.total, 0) / count),
                active: Math.round(metrics.reduce((sum, m) => sum + m.regions.active, 0) / count)
            },
            connections: {
                total: Math.round(metrics.reduce((sum, m) => sum + m.connections.total, 0) / count),
                average: parseFloat((metrics.reduce((sum, m) => sum + m.connections.average, 0) / count).toFixed(2))
            }
        };
    }
}

export default MetricsCollector;