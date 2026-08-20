import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    /**
     * Vitest's default is 5000ms, which is genuinely wrong for this suite (2026-08-19).
     *
     * Found by a real intermittent failure, not by reading docs: `experienceFloorImpact`'s
     * multi-seed comparison failed once in a full-suite run at 5349ms, then passed in
     * isolation at 3417ms. The assertion was never close to failing on its merits — measured
     * directly afterward, its 3-seed mean is 0.094% against a 5% bar — it simply ran past the
     * default timeout while sharing a machine with the rest of the suite.
     *
     * Several tests here run real 1500-3000 day simulations across multiple seeds and
     * legitimately take 3-9 seconds. They are deterministic and CPU-bound, with no network or
     * I/O that could hang, so a long timeout costs nothing when things are healthy and only
     * ever removes a false failure. A genuinely stuck test still fails, just later.
     */
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
