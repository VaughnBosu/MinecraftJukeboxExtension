const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    timeout: 120_000,
    expect: {
        timeout: 15_000
    },
    reporter: 'list',
    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    }
});
