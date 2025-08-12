import { useCallback, useRef } from "react";
import { useLogger } from "./useLogger";

interface PerformanceTimer {
	start: (name: string, metadata?: Record<string, any>) => void;
	end: (name: string, metadata?: Record<string, any>) => void;
	measure: <T>(name: string, fn: () => T, metadata?: Record<string, any>) => T;
	measureAsync: <T>(name: string, fn: () => Promise<T>, metadata?: Record<string, any>) => Promise<T>;
}

/**
 * Hook for measuring performance of operations with automatic logging
 */
export const usePerformanceLogger = (): PerformanceTimer => {
	const { logFrontendEvent } = useLogger();
	const timers = useRef<Map<string, number>>(new Map());

	const start = useCallback(
		(name: string, metadata: Record<string, any> = {}) => {
			timers.current.set(name, Date.now());
			logFrontendEvent({
				event_name: "performance_timer_start",
				error_level: "debug",
				payload: { timerName: name, ...metadata },
			});
		},
		[logFrontendEvent],
	);

	const end = useCallback(
		(name: string, metadata: Record<string, any> = {}) => {
			const startTime = timers.current.get(name);
			if (startTime) {
				const duration = Date.now() - startTime;
				timers.current.delete(name);
				logFrontendEvent({
					event_name: "performance_timer_end",
					error_level: "log",
					payload: { timerName: name, duration, ...metadata },
				});
			}
		},
		[logFrontendEvent],
	);

	const measure = useCallback(
		<T>(name: string, fn: () => T, metadata: Record<string, any> = {}): T => {
			const startTime = Date.now();
			try {
				const result = fn();
				const duration = Date.now() - startTime;
				logFrontendEvent({
					event_name: "performance_measure",
					error_level: "log",
					payload: { operation: name, duration, success: true, ...metadata },
				});
				return result;
			} catch (error) {
				const duration = Date.now() - startTime;
				logFrontendEvent({
					event_name: "performance_measure",
					error_level: "error",
					payload: { operation: name, duration, success: false, error: String(error), ...metadata },
				});
				throw error;
			}
		},
		[logFrontendEvent],
	);

	const measureAsync = useCallback(
		async <T>(name: string, fn: () => Promise<T>, metadata: Record<string, any> = {}): Promise<T> => {
			const startTime = Date.now();
			try {
				const result = await fn();
				const duration = Date.now() - startTime;
				logFrontendEvent({
					event_name: "performance_measure_async",
					error_level: "log",
					payload: { operation: name, duration, success: true, ...metadata },
				});
				return result;
			} catch (error) {
				const duration = Date.now() - startTime;
				logFrontendEvent({
					event_name: "performance_measure_async",
					error_level: "error",
					payload: { operation: name, duration, success: false, error: String(error), ...metadata },
				});
				throw error;
			}
		},
		[logFrontendEvent],
	);

	return { start, end, measure, measureAsync };
};
