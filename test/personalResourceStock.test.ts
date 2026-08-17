import { describe, expect, it } from 'vitest';
import {
  PERSONAL_RESOURCE_CAP,
  RESTOCK_INTERVAL_DAYS,
  emptyPersonalStock,
  stepPersonalStock,
} from '../src/engine/personalResourceStock.js';

describe('personal resource stock — accrues while FILLED, caps at 5', () => {
  it('starts empty', () => {
    expect(emptyPersonalStock()).toEqual({ stock: 0, daysSinceRestock: 0 });
  });

  it('does not restock before the interval elapses', () => {
    let state = emptyPersonalStock();
    for (let i = 0; i < RESTOCK_INTERVAL_DAYS - 1; i++) {
      state = stepPersonalStock(state);
    }
    expect(state.stock).toBe(0);
  });

  it('restocks by exactly 1 the day the interval elapses, then resets the counter', () => {
    let state = emptyPersonalStock();
    for (let i = 0; i < RESTOCK_INTERVAL_DAYS; i++) {
      state = stepPersonalStock(state);
    }
    expect(state.stock).toBe(1);
    expect(state.daysSinceRestock).toBe(0);
  });

  it('never exceeds PERSONAL_RESOURCE_CAP no matter how long a slot stays FILLED', () => {
    let state = emptyPersonalStock();
    for (let i = 0; i < RESTOCK_INTERVAL_DAYS * (PERSONAL_RESOURCE_CAP + 10); i++) {
      state = stepPersonalStock(state);
    }
    expect(state.stock).toBe(PERSONAL_RESOURCE_CAP);
  });

  it('restocks are evenly spaced, not front-loaded or back-loaded', () => {
    let state = emptyPersonalStock();
    const restockDays: number[] = [];
    for (let day = 1; day <= RESTOCK_INTERVAL_DAYS * 4; day++) {
      const before = state.stock;
      state = stepPersonalStock(state);
      if (state.stock > before) restockDays.push(day);
    }
    expect(restockDays).toEqual([RESTOCK_INTERVAL_DAYS, RESTOCK_INTERVAL_DAYS * 2, RESTOCK_INTERVAL_DAYS * 3, RESTOCK_INTERVAL_DAYS * 4]);
  });
});
