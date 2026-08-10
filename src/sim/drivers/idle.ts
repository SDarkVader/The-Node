import type { Driver } from './types.js';

/** Always does nothing — the baseline "no decision" control case for load-testing the kernel. */
export const idleDriver: Driver = () => ({ type: 'idle' });
